const pluginPackage = require('./package.json')

let Characteristic
let Service

const PLUGIN_NAME = 'homebridge-ismartgate-sensor'
const ACCESSORY_NAME = 'iSmartGate'

module.exports = function (homebridge) {
	Characteristic = homebridge.hap.Characteristic
	Service = homebridge.hap.Service
	homebridge.registerAccessory(PLUGIN_NAME, ACCESSORY_NAME, ISmartGateAccessory)
}

class ISmartGateAccessory {
	constructor(log, config) {
		this.log = log
		this.name = config.name || 'iSmartGate Temperature'
		this.username = config.username
		this.password = config.password
		this.hostname = config.hostname
		this.cookie = null
		this.currentTemperature = 0
		this.batteryLevel = 0
		this.refreshInFlight = false
		this.refreshTimer = null
		this.loginTimer = null
		this.isConfigured = Boolean(this.username && this.password && this.hostname)
		if (!this.isConfigured) {
			this.log.error('Missing required configuration: username, password, and hostname are required.')
		}
	}

	getServices() {
		this.TemperatureSensor = new Service.TemperatureSensor(this.name)
		this.BatteryService = new Service.Battery(this.name)
		this.AccessoryInformation = new Service.AccessoryInformation()
		this.AccessoryInformation.setCharacteristic(Characteristic.Name, this.name)
			.setCharacteristic(Characteristic.Manufacturer, 'iSmartGate')
			.setCharacteristic(Characteristic.Model, 'Temperature Sensor')
			.setCharacteristic(Characteristic.FirmwareRevision, pluginPackage.version)
			.setCharacteristic(Characteristic.SerialNumber, this.hostname || this.username || this.name)

		this.TemperatureSensor.getCharacteristic(Characteristic.CurrentTemperature).onGet(this.handleCurrentTemperatureGet.bind(this))
		this.BatteryService.getCharacteristic(Characteristic.BatteryLevel).onGet(this.handleBatteryLevelGet.bind(this))
		this.BatteryService.getCharacteristic(Characteristic.StatusLowBattery).onGet(this.handleBatteryStatusGet.bind(this))

		if (this.isConfigured) {
			this.startPolling()
		}

		return [this.AccessoryInformation, this.TemperatureSensor, this.BatteryService]
	}

	startPolling() {
		void this.login().then(() => this.refresh())
		this.refreshTimer = setInterval(() => {
			void this.refresh()
		}, 600000)
		this.loginTimer = setInterval(() => {
			void this.login()
		}, 10800000)
	}

	async handleCurrentTemperatureGet() {
		return this.currentTemperature
	}

	async handleBatteryLevelGet() {
		return this.batteryLevel
	}

	async handleBatteryStatusGet() {
		return this.batteryLevel <= 10 ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL
	}

	async login() {
		this.log.info('Retrieving token for %s', this.hostname)
		try {
			const body = new URLSearchParams({
				login: this.username,
				pass: this.password,
				'send-login': 'Sign in',
			})
			const response = await fetch(`http://${this.hostname}/index.php`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
				},
				body,
			})
			if (!response.ok) {
				const responseBody = await response.text().catch(() => '')
				this.log.error('Error signing in to %s: HTTP %s', this.hostname, response.status)
				if (responseBody) {
					this.log.debug(responseBody)
				}
				return
			}
			const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []
			const rawCookie = cookies[0] || response.headers.get('set-cookie')
			if (!rawCookie) {
				this.log.error('Logged in to %s but did not receive session cookie.', this.hostname)
				return
			}
			this.cookie = rawCookie.split(';')[0]
			this.log.info('Logged into iSmartGate successfully for %s', this.hostname)
		} catch (err) {
			this.log.error('Error signing in to %s: %s', this.hostname, err.message)
		}
	}

	async refresh() {
		if (this.refreshInFlight) {
			return
		}
		this.refreshInFlight = true
		try {
			if (!this.cookie) {
				await this.login()
			}
			if (!this.cookie) {
				return
			}

			this.log.debug('Start refreshing temperature & battery')
			const response = await fetch(`http://${this.hostname}/isg/temperature.php?door=1`, {
				method: 'GET',
				headers: {
					Cookie: this.cookie,
				},
			})
			const body = await response.text()
			if (!response.ok) {
				this.log.error('Error fetching temperature & battery from %s. HTTP %s', this.hostname, response.status)
				if (body) {
					this.log.debug(body)
				}
				return
			}

			if (body === 'Restricted Access' || body === 'Login Token Expired') {
				this.log.error(body)
				if (body === 'Login Token Expired') {
					this.cookie = null
				}
				return
			}

			let payload
			try {
				payload = JSON.parse(body)
			} catch (err) {
				this.log.error('Unexpected non-JSON response while reading temperature & battery from %s.', this.hostname)
				this.log.debug(body)
				return
			}

			if (!Array.isArray(payload) || payload.length < 2) {
				this.log.warn('Unexpected payload received from iSmartGate.')
				this.log.debug(JSON.stringify(payload))
				return
			}

			const parsedTemperature = Number(payload[0]) / 1000
			if (Number.isFinite(parsedTemperature)) {
				this.currentTemperature = parsedTemperature
				this.TemperatureSensor.updateCharacteristic(Characteristic.CurrentTemperature, this.currentTemperature)
			} else {
				this.log.warn('Unexpected temperature value received: %s', payload[0])
			}

			const batteryMap = {
				full: 100,
				'80': 80,
				'60': 60,
				'40': 40,
				'20': 20,
				low: 10,
			}
			const mappedBattery = batteryMap[payload[1]]
			this.batteryLevel = typeof mappedBattery === 'number' ? mappedBattery : 0
			if (typeof mappedBattery !== 'number') {
				this.log.warn('Unexpected BatteryLevel detected: %s', payload[1])
			}

			this.BatteryService.updateCharacteristic(Characteristic.BatteryLevel, this.batteryLevel)
			this.BatteryService.updateCharacteristic(
				Characteristic.StatusLowBattery,
				this.batteryLevel <= 10 ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL
			)
		} catch (err) {
			this.log.error('Error retrieving temperature & battery %s', err.message)
		} finally {
			this.refreshInFlight = false
		}
	}
}
