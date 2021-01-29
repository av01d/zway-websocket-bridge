/**
 * Z-Way WebSocket Bridge
 * (c) 2020 by Arjan Haverkamp (arjan@webgear.nl)
 * Inspired by https://github.com/blakeblackshear/zway-websocket
 */

function WebSocketBridge(id, controller) {
	WebSocketBridge.super_.call(this, id, controller);
}

inherits(WebSocketBridge, BaseModule);
_module = WebSocketBridge;

/**
 * Initialize this module.
 * Start a listener to listen for changes in metrics on all devices.
 */
WebSocketBridge.prototype.init = function(config) {
	WebSocketBridge.super_.prototype.init.call(this, config);
	
	var self = this;

	this.verbose = false; // Set to true for more debug info in z-way-server.log
	this.wsServer = config.wsServer;
	this.sock = null;
	this.connecting = false;
	this.connected = false;

	// Device-change handler:
	self.handlerModify = function(vDev) {
		self.sendMessage('deviceChange', self._getData(vDev));
	};

	self.handlerChange = function(vDev) {
		if (!self.connected) {
			self.connectToServer();
		}
	}

	self.connectToServer(); // Initial socket connect
	self.controller.devices.on('modify:metrics:level', self.handlerModify);
	self.controller.devices.on('change:metrics:level', self.handlerChange);
};

/**
 * Connect to the socket server.
 * Prevent race conditions via `self.connecting`.
 */
WebSocketBridge.prototype.connectToServer = function() {
	var self = this;

	if (self.connecting) {
		return; 
	}

	self.connecting = true;

	try {
		self.sock = new sockets.websocket(self.wsServer);

		self.sock.onopen = function() {
			self.connected = true;
			self.verbose && self.log('Socket: Connected');
			// Send status of all devices when connected
			self.sendMessage('allDevices', self.getAllDevices()); 
			setTimeout(function() {
				self.connecting = false;
			}, 100)
		}

		self.sock.onmessage = function(ev) {
			self.verbose && self.log('Socket: Received Message: ' + ev.data);
			self.processMessage(ev.data);
		}

		self.sock.onclose = function(ev) {
			self.verbose && self.log('Socket: Connection closed');
			self.connected = false;
		}

		self.sock.onerror = function(ev) {
			self.verbose && self.log('Socket: Error: ' + ev.data);
			self.connected = false;
			self.connecting = false;
		}
	} catch(err) {
		self.error(err);
		setTimeout(function() {
			self.connecting = false;
		}, 100)
	}
}

/**
 * Send a message to the websocket server.
 * If not connected, connect first.
 */
WebSocketBridge.prototype.sendMessage = function(msgType, data) {
	if (!this.connected) {
		// (Re)Connect:
		this.connectToServer();
	}

	var json = {
		type: msgType,
		data: data
	};

	this.connected && this.sock.send(JSON.stringify(json));
}

/**
 * Process an incoming message.
 * The message should be in JSON format, otherwise we don't accept.
 * Example message:
 * {
 *   'socketCommand': 'setDevice',
 *   'vDevId': 'ZWayVDev_zway_30-0-38',
 *   'onoff': 'on', // 'on', 'off', ...
 *   'level' 55
 * }
 * - or -
 * {
 *   'socketCommand': 'getAll'
 * }
 */
WebSocketBridge.prototype.processMessage = function(message) {
	var self = this, json;
	try {
		json = JSON.parse(message); 
	} catch(err) {
		self.log('Unable to parse message: ' + err);
		return;
	}

	switch(json.socketCommand) {
		case 'setDevice':
			 self.setDevice(json.vDevId, json.command, json.extra || {});
			 break;

		case 'getAll':
			self.sendMessage('allDevices', self.getAllDevices());
			break;
	}
}

/**
 * Change the level of a device.
 *
 * @param id(string): vDevID (f.e: ZWayVDev_zway_30-0-38)
 * @param command(string): Either 'on', 'off' 
 * @param extra(object): {
 *    level: 50,
 *    r: 10,
 *    g: 20,
 *    b: 30
 * }
 */
WebSocketBridge.prototype.setDevice = function(id, command, extra) {
	var vDev = this.controller.devices.get(id);
	if (!vDev) {
		this.error('Device ' + id + ' does not exist.');
		return;
	}

	var deviceType = vDev.get('deviceType');

	if (/sensor/i.test(deviceType)) {
		this.error('Can\'t perform action on sensor ' + device.get('metrics:title'));
		return;
	}

	switch(deviceType) {
		case 'switchMultilevel':
		case 'thermostat':
			if ('level' in extra) {
				vDev.performCommand('exact', { level: extra.level });
			}
			else {
				vDev.performCommand(command);
			}
			break;

		case 'switchRGBW':
			if ('r' in extra && 'g' in extra && 'b' in extra) {
				vDev.performCommand('exact', {
					red: extra.r,
					green: extra.g,
					blue: extra.b,
				});
			}
			else {
				vDev.performCommand(command);
			}
			break;

		case 'switchControl':
			if ('level' in extra) {
				if (/(upstart|upstop|downstart|downstop)/.test(extra.level)) {
					vDev.performCommand('exact', { change: extra.level });
				}
				else {
					vDev.performCommand('exact', { level: extra.level });
				}
			}
			else {
				vDev.performCommand(command);
			}
			break;

		case 'toggleButton':
			vDev.performCommand('on');
			break;

		default: 
			// Includes: switchBinary, doorlock
			vDev.performCommand(command);
			break;
	}
}

/**
 * Retrieve the on/off/level states of all available devices.
 */
WebSocketBridge.prototype.getAllDevices = function() {
	var self = this, json = {};
	self.controller.devices.each(function(vDev) {
		var id = vDev.get('id');
		if (/^ZWayVDev/.test(id)) {
			json[id] = self._getData(vDev);
		}
	});

	return json;
}

/**
 * Construct a JSON object containing device info.
 */
WebSocketBridge.prototype._getData = function(vDev) {

	function convertLevel() {
		var metric = vDev.get('metrics:level'), onoff = 'off', level;
		var lastLevel = vDev.get('metrics:lastLevel');
		if (/^\-?\d+(\.\d+)?$/.test(metric)) {
			// metric is an integer
			level = +metric;
			onoff = (metric == 0) ? 'off' : 'on';
		}
		else {
			// metric == 'on', 'off', ...
			level = (/off|close/.test(metric)) ? 0 : 100;
			onoff = metric;
		}
		return {onoff:onoff, level:level};
	}

	var metric = convertLevel();

	return {
		vDevId: vDev.get('id'),
		onoff: metric.onoff,
		level: metric.level,
		lastLevel: vDev.get('metrics:lastLevel'),
		name: vDev.get('name'),
		title: vDev.get('metrics:title'),
		type: vDev.get('deviceType'),
		modificationTime: vDev.get('metrics:modificationTime')
	};
}

/**
 * Stop this module
 */
WebSocketBridge.prototype.stop = function() {
	this.sock && this.sock.close();
	this.controller.devices.off('modify:metrics:level', this.handlerModify);
	this.controller.devices.off('change:metrics:level', this.handlerChange);
	WebSocketBridge.super_.prototype.stop.call(this);
};
