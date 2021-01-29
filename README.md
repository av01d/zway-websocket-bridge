# zway-websocket-bridge
Z-Way app to publish all 'modify:metrics:level' events of all devices to a Websocket-Server. Can be used to build bridges to other ecosystems.

## App Options in Z-Way
Option | Description
--- | ---
Websocket address | The websocket address to send device events to.

## Data Format
The data that will be sent is JSON in the following structure
```
{
   device: <ID of device (int)>,
   instance: <Device instance (int)>,
   commandClass: <Command class (int)>,
   title: <Title of device (string)>,
   vDevId: <ID of device (string)>
   room: <Location of device (string)>
   type: <Type of device (string)>,
   lastLevel: <Last known level of device (string|int)>,
   level: <Level of device (string|int)>,
   modificationTime: <Timestamp of event (int)>
}
```
