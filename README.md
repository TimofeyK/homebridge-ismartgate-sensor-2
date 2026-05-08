# homebridge-ismartgate-sensor-2

A [Homebridge](https://github.com/homebridge/homebridge) plugin for iSmartGate devices that exposes their Temperature and Battery sensors to HomeKit. These sensors are normally hidden from HomeKit and are only visible through the iSmartGate app.

## Fork History

This project is a fork of [homebridge-ismartgate-sensor](https://github.com/valiquette/homebridge-ismartgate-sensor) by John Valiquette, which was itself forked from [homebridge-ismartgate](https://github.com/codyc1515/homebridge-ismartgate) by codyc1515 (now archived).

## Notes

* This plugin only exposes Temperature and Battery sensors. The iSmartGate device already provides native HomeKit support for gate control.
* This plugin communicates with the iSmartGate device over its local API using plain HTTP with username/password authentication. This is how the device API works.
* Targets Homebridge 2.x.

## Legal

* Licensed under [MIT](LICENSE).
* This is not an official plugin and is not affiliated with iSmartGate in any way.
