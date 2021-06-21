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

// The remote heimdall API
const REMOTE_HEIMDALL_API = "https://heimdall.api.matic.network/checkpoints/count"

// How many heimdall blocks our node can be behind before we page.
const LOCAL_HEIMDALL_LAG_ALERT_AMOUNT = 5

// How many heimdall blocks the remote node can be behind before we page.
const REMOTE_HEIMDALL_LAG_ALERT_AMOUNT = 100

// The local bor API
const LOCAL_BOR_API = "http://127.0.0.1:8545"

// The remote bor API
const REMOTE_BOR_API = "https://rpc-mainnet.maticvigil.com"

// How many heimdall blocks our node can be behind before we page.
const LOCAL_BOR_LAG_ALERT_AMOUNT = 5

// How many heimdall blocks the remote node can be behind before we page.
const REMOTE_BOR_LAG_ALERT_AMOUNT = 100

// The validator ID to monitor for signatures on Heimdall
// See: .heimdalld/config/priv_validator_key.json 
const HEIMDALL_VALIDATOR_ADDRESS = "13DC53FA54E7D662FF305B6C3EF95090C31DC576"

// The number of consecutive heimdall blocks that cannot be signed.
const ACCEPTABLE_CONSECUTIVE_HEIMDALL_MISSES = 3

// How often to run a health check.
const CHECK_INTERVAL_SECONDS = 30 // 30 seconds

// How often to send a page for the same event.
const THROTTLE_INTERVAL_SECONDS = 5 * 60 // 5 minutes

// The number of times the process can error before it pages you. 
// This servers to stop users from accidentally getting paged if the local or remote
// APIs experience a temporary outage.
const ACCEPTABLE_CONSECUTIVE_FLAKES = 3

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
      // Verify Heimdall block heights
      const heimdallDataUrl = `${LOCAL_HEIMDALL_API}/block`
      const heimdallDataResult = await WebRequest.get(heimdallDataUrl)
      const localHeimdallHeight = new BigNumber(JSON.parse(heimdallDataResult.content).result.block.header.height)

      const remoteHeimdallHeightResult = await WebRequest.get(REMOTE_HEIMDALL_API)
      const remoteHeimdallHeight = new BigNumber(JSON.parse(remoteHeimdallHeightResult.content).height)

      console.log("Heimdall Block Heights:")
      console.log(`Local: ${localHeimdallHeight.toFixed()}, Remote: ${remoteHeimdallHeight.toFixed()}`)

      if (remoteHeimdallHeight.minus(localHeimdallHeight).isGreaterThan(LOCAL_HEIMDALL_LAG_ALERT_AMOUNT)) {
        console.log('Local heimdall node lag too high. Paging')
        page("Local heimdall node is lagging", `Lag: ${remoteHeimdallHeight.minus(localHeimdallHeight).toFixed()}`, THROTTLE_INTERVAL_SECONDS, `local_heimdall_lag`)
      }

      if (localHeimdallHeight.minus(remoteHeimdallHeight).isGreaterThan(REMOTE_HEIMDALL_LAG_ALERT_AMOUNT)) {
        console.log('Remote heimdall node lag too high. Paging')
        page("Remote heimdall node is lagging", `Lag: ${localHeimdallHeight.minus(remoteHeimdallHeight).toFixed()}`, THROTTLE_INTERVAL_SECONDS, `remote_heimdall_lag`)
      }
      console.log("")

      // Get Bor Block Heights 
      const localBorHeightResult = await WebRequest.post(
        LOCAL_BOR_API,
        {
          headers: {
            "Content-Type": "application/json"
          }
        },
        JSON.stringify(
          {
            jsonrpc: "2.0",
            method: "eth_blockNumber",
            params: [],
            id: 1
          }
        )
      )
      const localBorHeight = new BigNumber(JSON.parse(localBorHeightResult.content).result)

      const remoteBorHeightResult = await WebRequest.post(
        REMOTE_BOR_API,
        {
          headers: {
            "Content-Type": "application/json"
          }
        },
        JSON.stringify(
          {
            jsonrpc: "2.0",
            method: "eth_blockNumber",
            params: [],
            id: 1
          }
        )
      )
      const remoteBorHeight = new BigNumber(JSON.parse(remoteBorHeightResult.content).result)

      console.log("Bor Block Heights:")
      console.log(`Local: ${localBorHeight.toFixed()}, Remote: ${remoteBorHeight.toFixed()}`)

      if (remoteBorHeight.minus(localBorHeight).isGreaterThan(LOCAL_BOR_LAG_ALERT_AMOUNT)) {
        console.log('Local bor node lag too high. Paging')
        page("Local bor node is lagging", `Lag: ${remoteBorHeight.minus(localBorHeight).toFixed()}`, THROTTLE_INTERVAL_SECONDS, `local_bor_lag`)
      }

      if (localBorHeight.minus(remoteBorHeight).isGreaterThan(REMOTE_BOR_LAG_ALERT_AMOUNT)) {
        console.log('Remote bor node lag too high. Paging')
        page("Remote bor node is lagging", `Lag: ${localBorHeight.minus(remoteBorHeight).toFixed()}`, THROTTLE_INTERVAL_SECONDS, `remote_bor_lag`)
      }
      console.log("")

      // Verify signature appears in Heimdall block. 
      let foundHeimdall = false
      const precommits: Array<any> = JSON.parse(heimdallDataResult.content).result.block.last_commit.precommits
      for (let i = 0; i < precommits.length; i++) {
        const precommit = precommits[i]

        // Skip precommits that are missing.
        if (precommit == null) {
          continue
        }

        if (precommit.validator_address === HEIMDALL_VALIDATOR_ADDRESS) {
          foundHeimdall = true
        }
      }
      if (foundHeimdall = true) {
        console.log("Found Heimdall precommit.")
        consecutiveHeimdallMisses = 0
      } else {
        consecutiveHeimdallMisses++
        console.log("Missed Heimdall precommit in block " + localHeimdallHeight + ". Consecutive Heimdall misses is now: " + consecutiveHeimdallMisses)
      }

      if (consecutiveHeimdallMisses > ACCEPTABLE_CONSECUTIVE_HEIMDALL_MISSES) {
        page("Missed Heimdall Precommits", "Consecutive misses: " + consecutiveHeimdallMisses, THROTTLE_INTERVAL_SECONDS, "missed_heimdall_precommit")
      }
      console.log("")

      // Verify signatures appear in the Bor block.
      // TODO(keefertaylor): Implement.

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
