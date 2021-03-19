import { randomBytes } from 'ilp-protocol-stream/dist/src/crypto'
import nock from 'nock'
import {
  GenericContainer,
  Network,
  StartedNetwork,
  StartedTestContainer,
  Wait,
} from 'testcontainers'
import Axios from 'axios'
import PluginHttp from 'ilp-plugin-http'
import getPort from 'get-port'
import { describe, it, expect, afterAll } from '@jest/globals'
import { setupPayment } from '../src'
import { Plugin } from 'ilp-protocol-stream/dist/src/util/plugin-interface'

describe('interledger.rs integration', () => {
  let network: StartedNetwork | undefined
  let redisContainer: StartedTestContainer | undefined
  let rustNodeContainer: StartedTestContainer | undefined
  let plugin: Plugin | undefined

  it('pays to SPSP server', async () => {
    network = await new Network().start()

    // Setup Redis
    redisContainer = await new GenericContainer('redis')
      .withName('redis')
      .withNetworkMode(network.getName())
      .start()

    // Setup the Rust connector
    const adminAuthToken = 'admin'
    rustNodeContainer = await new GenericContainer('interledgerrs/ilp-node:latest')
      .withEnv('ILP_SECRET_SEED', randomBytes(32).toString('hex'))
      .withEnv('ILP_ADMIN_AUTH_TOKEN', adminAuthToken)
      .withEnv('ILP_DATABASE_URL', `redis://redis:6379`)
      .withEnv('ILP_ILP_ADDRESS', 'g.corp')
      .withEnv('ILP_HTTP_BIND_ADDRESS', '0.0.0.0:7770')
      .withName('connector')
      .withNetworkMode(network.getName())
      .withExposedPorts(7770)
      .withWaitStrategy(Wait.forLogMessage('HTTP API listening'))
      .start()

    // Since payment pointers MUST use HTTPS and using a local self-signed cert/CA puts
    // constraints on the environment running this test, just manually mock an HTTPS proxy to the Rust SPSP server
    const host = `${rustNodeContainer.getHost()}:${rustNodeContainer.getMappedPort(7770)}`
    const scope = nock('https://mywallet.com')
      .get('/.well-known/pay')
      .matchHeader('Accept', /application\/spsp4\+json*./)
      .delay(1000)
      .reply(200, () => Axios.get(`http://${host}/accounts/receiver/spsp`).then((res) => res.data))

    // Create receiver account
    await Axios.post(
      `http://${host}/accounts`,
      {
        username: 'receiver',
        asset_code: 'EUR',
        asset_scale: 6,
        // Required to interact with the account over its HTTP API
        ilp_over_http_outgoing_token: 'password',
        ilp_over_http_incoming_token: 'password',
      },
      {
        headers: {
          Authorization: `Bearer ${adminAuthToken}`,
        },
      }
    )

    const senderPort = await getPort()
    plugin = new PluginHttp({
      incoming: {
        port: senderPort,
        staticToken: 'password',
      },
      outgoing: {
        url: `http://${host}/accounts/sender/ilp`,
        staticToken: 'password',
      },
    })
    await plugin.connect()

    // Create account for sender to connect to
    await Axios.post(
      `http://${host}/accounts`,
      {
        username: 'sender',
        asset_code: 'EUR',
        asset_scale: 6,
        routing_relation: 'child',
        ilp_over_http_url: `http://localhost:${senderPort}`,
        ilp_over_http_outgoing_token: 'password',
        ilp_over_http_incoming_token: 'password',
        max_packet_amount: '2000',
      },
      {
        headers: {
          Authorization: `Bearer ${adminAuthToken}`,
        },
      }
    )

    const amountToSend = BigInt(100_000) // 0.1 EUR, ~50 packets @ max packet amount of 2000
    const { startQuote: quote } = await setupPayment({
      plugin,
      paymentPointer: '$mywallet.com',
    })
    const { pay } = await quote({
      amountToSend,
      sourceAsset: {
        code: 'EUR',
        scale: 6,
      },
    })

    const receipt = await pay()
    expect(receipt.error).toBeUndefined()
    expect(receipt.amountSent.value).toBe(amountToSend)
    expect(receipt.amountDelivered.value).toBe(amountToSend) // Exchange rate is 1:1

    // Check the balance
    const { data } = await Axios({
      method: 'GET',
      url: `http://${host}/accounts/receiver/balance`,
      headers: {
        Authorization: 'Bearer password',
      },
    })
    // Interledger.rs balances are in normal units
    expect(data.balance).toBe(0.1)

    scope.done()
  }, 30_000)

  afterAll(async () => {
    await plugin?.disconnect()

    await rustNodeContainer?.stop()
    await redisContainer?.stop()

    await network?.stop()
  })
})

describe('interledger4j integration', () => {
  let network: StartedNetwork | undefined
  let redisContainer: StartedTestContainer | undefined
  let connectorContainer: StartedTestContainer | undefined
  let plugin: Plugin | undefined

  it('pays to SPSP server', async () => {
    network = await new Network().start()

    // Setup Redis
    redisContainer = await new GenericContainer('redis')
      .withName('redis')
      .withNetworkMode(network.getName())
      .start()

    // Setup the Java connector
    const adminPassword = 'admin'
    connectorContainer = await new GenericContainer('interledger4j/java-ilpv4-connector:0.5.1')
      .withEnv('redis.host', 'redis') // Hostname of Redis container
      .withEnv('interledger.connector.adminPassword', adminPassword)
      .withEnv('interledger.connector.spsp.serverSecret', randomBytes(32).toString('base64'))
      .withEnv('interledger.connector.enabledFeatures.localSpspFulfillmentEnabled', 'true')
      .withEnv('interledger.connector.enabledProtocols.spspEnabled', 'true')
      .withNetworkMode(network.getName())
      .withExposedPorts(8080)
      .withWaitStrategy(Wait.forLogMessage('STARTED INTERLEDGER CONNECTOR'))
      .start()

    // Since payment pointers MUST use HTTPS and using a local self-signed cert/CA puts
    // constraints on the environment running this test, just manually mock an HTTPS proxy to the SPSP server
    const host = `${connectorContainer.getHost()}:${connectorContainer.getMappedPort(8080)}`
    const scope = nock('https://mywallet.com')
      .get('/.well-known/pay')
      .matchHeader('Accept', /application\/spsp4\+json*./)
      .delay(500)
      .reply(200, () =>
        Axios.get(`http://${host}/receiver`, {
          headers: {
            Accept: 'application/spsp4+json',
          },
        }).then((res) => res.data)
      )

    // Create receiver account
    await Axios.post(
      `http://${host}/accounts`,
      {
        accountId: 'receiver',
        accountRelationship: 'PEER',
        linkType: 'ILP_OVER_HTTP',
        assetCode: 'USD',
        assetScale: '6',
        sendRoutes: true,
        receiveRoutes: true,
        customSettings: {
          'ilpOverHttp.incoming.auth_type': 'SIMPLE',
          'ilpOverHttp.incoming.simple.auth_token': 'password',
        },
      },
      {
        auth: {
          username: 'admin',
          password: adminPassword,
        },
      }
    )

    const senderPort = await getPort()
    plugin = new PluginHttp({
      incoming: {
        port: senderPort,
        staticToken: 'password',
      },
      outgoing: {
        url: `http://${host}/accounts/sender/ilp`,
        staticToken: 'password',
      },
    })
    await plugin.connect()

    // Create account for sender to connect to
    await Axios.post(
      `http://${host}/accounts`,
      {
        accountId: 'sender',
        accountRelationship: 'CHILD',
        linkType: 'ILP_OVER_HTTP',
        assetCode: 'USD',
        assetScale: '6',
        maximumPacketAmount: '400000', // $0.40
        sendRoutes: true,
        receiveRoutes: true,
        customSettings: {
          'ilpOverHttp.incoming.auth_type': 'SIMPLE',
          'ilpOverHttp.incoming.simple.auth_token': 'password',
        },
      },
      {
        auth: {
          username: 'admin',
          password: adminPassword,
        },
      }
    )

    const amountToSend = BigInt(9_800_000) // $9.80
    const { startQuote: quote } = await setupPayment({
      plugin,
      paymentPointer: `$mywallet.com`,
    })
    const { pay, maxSourceAmount, minDeliveryAmount } = await quote({
      amountToSend,
      sourceAsset: {
        code: 'USD',
        scale: 6,
      },
    })

    const receipt = await pay()
    expect(receipt.error).toBeUndefined()
    expect(receipt.amountSent.value).toBe(amountToSend)
    expect(receipt.amountSent.value).toBeLessThanOrEqual(maxSourceAmount.value)

    // Check the balance
    const { data } = await Axios({
      method: 'GET',
      url: `http://${host}/accounts/receiver/balance`,
      auth: {
        username: 'admin',
        password: adminPassword,
      },
    })

    const netBalance = BigInt(data.accountBalance.netBalance)
    expect(receipt.amountDelivered.value).toEqual(netBalance)
    expect(minDeliveryAmount.value).toBeLessThanOrEqual(netBalance)

    scope.done()
  }, 60_000)

  afterAll(async () => {
    await plugin?.disconnect()

    await connectorContainer?.stop()
    await redisContainer?.stop()

    await network?.stop()
  }, 10_000)
})
