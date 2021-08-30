const PagerDuty = require('node-pagerduty');
import * as WebRequest from 'web-request'
import { BigNumber } from 'bignumber.js'

/** Start Config - Provide values for these: */

// Your PagerDuty API key. Note this is your personal API key, NOT a service integration.
const PAGER_DUTY_API_KEY = ""

// The identifier of your service on PagerDuty.
const PAGER_DUTY_SERVICE = ""

// The email you use for PagerDuty.
const PAGER_DUTY_EMAIL = ""

// Infura URL
const INFURA_URL = ""

// Signer key
const SIGNER_KEY = "0x13dC53fa54E7d662Ff305b6C3EF95090c31dC576"

// Minimum eth balance allowed on the signer key.
const ETH_KEY_MIN_BALANCE = new BigNumber("300000000000000000") // .3 ETH

// The local heimdall API.
const LOCAL_HEIMDALL_API = "http://127.0.0.1:26657"

// The local bor API
const LOCAL_BOR_API = "http://127.0.0.1:8545"

// How often to run a health check.
const CHECK_INTERVAL_SECONDS = 30 // 30 seconds

// How often to send a page for the same event.
const THROTTLE_INTERVAL_SECONDS = 5 * 60 // 5 minutes

// The number of times the process can error before it pages you. 
// This servers to stop users from accidentally getting paged if the local or remote
// APIs experience a temporary outage.
const ACCEPTABLE_CONSECUTIVE_FLAKES = 15

// Amount of seconds allowed to be out of date before paging
const ACCEPTABLE_DELTA_SECS = 60

/** End Config */

let version = "0.0.1"

const pagerDutyClient = new PagerDuty(PAGER_DUTY_API_KEY);
const pagerDutyThrottle: Map<string, Date> = new Map();

let consecutiveHeimdallMisses = 0
let consecutiveFlakes = 0

const monitor = async () => {
  console.log("Starting Polygon Health Monitor v" + version)

  while (true) {
    console.log("Running Health Check!")
    console.log("")

    try {
      // Verify Heimdall recency
      const heimdallDataUrl = `${LOCAL_HEIMDALL_API}/block`
      const heimdallDataResult = await WebRequest.get(heimdallDataUrl)
      if (heimdallDataResult.statusCode !== 200) {
        throw new Error(`Local Heimdalld API is down! Error code ${heimdallDataResult.statusCode}: ${heimdallDataResult.content}`)
      }
      const apiData = JSON.parse(heimdallDataResult.content)
      const heimdallBlockTime = Date.parse(apiData.result.block.header.time) / 1000
      const currentTime = Date.now() / 1000
      const heimdallDeltaTime = Math.abs(currentTime - heimdallBlockTime)
      if (heimdallDeltaTime > ACCEPTABLE_DELTA_SECS) {
        await page("Heimdall node is lagging", `System Time: ${currentTime}, Block Time: ${heimdallBlockTime}. Is Hiemdalld  stalled?`, 5 * 60, "node-lag")
      } else {
        console.log("Heimdall is up to date")
      }
      console.log("")

      // Verify Bor Recency
      const borDataResult = await WebRequest.post(
        LOCAL_BOR_API,
        {
          headers: {
            "Content-Type": "application/json"
          }
        },
        JSON.stringify(
          {
            "jsonrpc":"2.0",
            "method":"eth_getBlockByNumber",
            "params":["latest", false],
            "id":1
          }
        )
      )
      if (borDataResult.statusCode !== 200) {
        throw new Error(`Local Bor API is down! Error code ${borDataResult.statusCode}: ${borDataResult.content}`)
      }
      const borData = JSON.parse(borDataResult.content)
      const borBlockTime = Date.parse(`${parseInt(borData.result.timestamp, 16)}`)
      const borDeltaDtime = Math.abs(currentTime - borBlockTime)
      if (borDeltaDtime > ACCEPTABLE_DELTA_SECS) {
        await page("Bor node is lagging", `System Time: ${currentTime}, Block Time: ${borDeltaDtime}. Is Bor  stalled?`, 5 * 60, "node-lag")
      } else {
      console.log("Bor is up to date")
    }

      console.log("")

      // Verify sufficient ETH is on the signer key.
      const balanceResult = await WebRequest.post(
        INFURA_URL,
        {
          headers: {
            "Content-Type": "application/json"
          }
        },
        JSON.stringify(
          {
            jsonrpc: "2.0",
            method: "eth_getBalance",
            params: [
              `${SIGNER_KEY}`,
              "latest"
            ],
            id: 1
          }
        )
      )
      const balance = new BigNumber(JSON.parse(balanceResult.content).result)

      console.log(`Computed balance to be: ${balance.toFixed()} wei`)
      if (balance.isLessThan(ETH_KEY_MIN_BALANCE)) {
        console.log("Balance is too low. Paging.")
        page("Low eth balance", `Balance: ${balance.toFixed}`, THROTTLE_INTERVAL_SECONDS, `low_balance`)
      }
      console.log("")

      consecutiveFlakes = 0
      console.log("Health check passed!")
      console.log("")
    } catch (e) {
      consecutiveFlakes++

      console.log("Unknown error: " + e + ". Consecutive flakes is now: " + consecutiveFlakes)
      if (consecutiveFlakes >= ACCEPTABLE_CONSECUTIVE_FLAKES) {
        console.log("Threshold exceeded. Paging.")
        page("Unknown error", e.message, 5 * 60, e.message)
      }
    }

    await sleep(CHECK_INTERVAL_SECONDS)
  }
}

/** Sleep for the given time. */
const sleep = async (seconds: number): Promise<void> => {
  const milliseconds = seconds * 1000
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/** Page according to throttling rules. */
/** Stolen shamelessly from: https://gitlab.com/polychainlabs/celo-network-monitor */
const page = async (title, details, throttleSeconds = 60, alertKey) => {
  alertKey = alertKey || title + details

  if (shouldAlert(pagerDutyThrottle, alertKey, throttleSeconds)) {
    console.log(`Paging: ${title}`)
    const payload = {
      incident: {
        title,
        type: 'incident',
        service: {
          id: PAGER_DUTY_SERVICE,
          type: 'service_reference',
        },
        body: {
          type: 'incident_body',
          details,
        },
        incident_key: alertKey,
      },
    };

    if (pagerDutyClient != undefined) {
      await pagerDutyClient.incidents.createIncident(PAGER_DUTY_EMAIL, payload)
    }
  }
}

/** Determine if we should page. */
/** Stolen shamelessly from: https://gitlab.com/polychainlabs/celo-network-monitor */
const shouldAlert = (throttle: Map<string, Date>, key: string, throttleSeconds: number): boolean => {
  if (!throttle.has(key)) {
    throttle.set(key, new Date());
    return true;
  }

  const now = new Date().getTime();
  const lastAlertTime = throttle.get(key)?.getTime() || 0;
  const secondsSinceAlerted = (now - lastAlertTime) / 1000;

  if (secondsSinceAlerted > throttleSeconds) {
    // We've passed our throttle delay period
    throttle.set(key, new Date());
    return true;
  }
  return false;
}

monitor()
