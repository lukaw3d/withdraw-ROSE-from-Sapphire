// @ts-check
import * as oasis from '@oasisprotocol/client'
import * as oasisRT from '@oasisprotocol/client-rt'
import { bytesToHex, privateToAddress, toChecksumAddress } from '@ethereumjs/util'

const sapphireConfig = {
  mainnet: {
    address: 'oasis1qrd3mnzhhgst26hsp96uf45yhq6zlax0cuzdgcfc',
    runtimeId: '000000000000000000000000000000000000000000000000f80306c9858e7279',
  },
  testnet: {
    address: 'oasis1qqczuf3x6glkgjuf0xgtcpjjw95r3crf7y2323xd',
    runtimeId: '000000000000000000000000000000000000000000000000a6d1e3ebf60dff6c',
  },
  gasPrice: 100n,
  feeGas: 70_000n, // hardcoded. TODO: update when sapphire is upgraded
  decimals: 18,
}
const consensusConfig = {
  decimals: 9,
}
const multiplyConsensusToSapphire = 10n ** BigInt(sapphireConfig.decimals - consensusConfig.decimals)

async function init() {
  const signer = oasisRT.signatureSecp256k1.EllipticSigner.fromRandom('this key is not important')
  const sapphireAddress = privateToEthAddress(signer.key.getPrivate('hex'))

  const consensusAddress =
    /** @type {`oasis1${string}`} */
    (prompt('Consensus address you want to send ROSE to', 'oasis1') || '')
  if (!isValidOasisAddress(consensusAddress)) throw new Error('Invalid consensus address')


  const nic = new oasis.client.NodeInternal('https://grpc.oasis.io')
  const chainContext = await nic.consensusGetChainContext()

  async function poll() {
    try {
      const sapphireBalance = await getSapphireBalance(sapphireAddress)
      const consensusBalance = await getConsensusBalance(consensusAddress)
      console.log({ sapphireBalance, consensusBalance })

      window.print_privatekey.textContent = signer.key.getPrivate('hex')
      window.print_sapphire_account.textContent = sapphireAddress + ' balance: ' + sapphireBalance
      window.print_consensus_account.textContent = consensusAddress + ' balance: ' + consensusBalance
      if (sapphireBalance <= 0n) {
        setTimeout(poll, 10000)
        return
      }

      console.log('withdrawable', sapphireBalance)
      const feeAmount = sapphireConfig.gasPrice * sapphireConfig.feeGas * multiplyConsensusToSapphire
      const amountToWithdraw = sapphireBalance - feeAmount

      // Withdraw into Sapphire
      const rtw = new oasisRT.consensusAccounts.Wrapper(
        oasis.misc.fromHex(sapphireConfig.mainnet.runtimeId),
      ).callWithdraw()
      rtw
        .setBody({
          amount: [oasis.quantity.fromBigInt(amountToWithdraw), oasisRT.token.NATIVE_DENOMINATION],
          to: oasis.staking.addressFromBech32(consensusAddress),
        })
        .setFeeAmount([oasis.quantity.fromBigInt(feeAmount), oasisRT.token.NATIVE_DENOMINATION])
        .setFeeGas(sapphireConfig.feeGas)
        .setFeeConsensusMessages(1)
        .setSignerInfo([
          {
            address_spec: {
              signature: { secp256k1eth: signer.public() },
            },
            nonce: await getSapphireNonce(await getEvmBech32Address(sapphireAddress)),
          },
        ])
      await rtw.sign([new oasis.signature.BlindContextSigner(signer)], chainContext)
      await rtw.submit(nic)
    } catch (err) {
      console.error(err)
      alert(err)
    }

    poll()
  }
  poll()

  window.addEventListener('beforeunload', event => {
    event.preventDefault()
    // Included for legacy support, e.g. Chrome/Edge < 119
    event.returnValue = true
  })
}
init().catch((err) => {
  console.error(err)
  alert(err)
})

// Utils

/** @param {`oasis1${string}`} oasisAddress */
function isValidOasisAddress(oasisAddress) {
  try {
    oasis.staking.addressFromBech32(oasisAddress)
    return true
  } catch (e) {
    return false
  }
}

/** @param {string} ethPrivateKey */
function privateToEthAddress(ethPrivateKey) {
  return /** @type {`0x${string}`} */ (
    toChecksumAddress(bytesToHex(privateToAddress(hexToBuffer(ethPrivateKey))))
  )
}

/** @param {string} value */
function hexToBuffer(value) {
  return Buffer.from(value, 'hex')
}

/** @param {`0x${string}`} evmAddress */
async function getEvmBech32Address(evmAddress) {
  const evmBytes = oasis.misc.fromHex(evmAddress.replace('0x', ''))
  const address = await oasis.address.fromData(
    oasisRT.address.V0_SECP256K1ETH_CONTEXT_IDENTIFIER,
    oasisRT.address.V0_SECP256K1ETH_CONTEXT_VERSION,
    evmBytes,
  )
  const bech32Address = /** @type {`oasis1${string}`}*/ (oasisRT.address.toBech32(address))
  return bech32Address
}

/**
 * @param {`oasis1${string}`} oasisAddress
 */
async function getConsensusBalance(oasisAddress) {
  const nic = new oasis.client.NodeInternal('https://grpc.oasis.io')
  const owner = oasis.staking.addressFromBech32(oasisAddress)
  const account = await nic.stakingAccount({ height: oasis.consensus.HEIGHT_LATEST, owner: owner })
  return oasis.quantity.toBigInt(account.general?.balance ?? new Uint8Array([0]))
}
/**
 * @param {`oasis1${string}`} oasisAddress
 */
async function getConsensusNonce(oasisAddress) {
  const nic = new oasis.client.NodeInternal('https://grpc.oasis.io')
  const nonce =
    (await nic.consensusGetSignerNonce({
      account_address: oasis.staking.addressFromBech32(oasisAddress),
      height: 0,
    })) ?? 0
  return nonce
}

/**
 * @param {`oasis1${string}`} oasisAddress
 */
async function getSapphireNonce(oasisAddress) {
  const nic = new oasis.client.NodeInternal('https://grpc.oasis.io')
  const accountsWrapper = new oasisRT.accounts.Wrapper(oasis.misc.fromHex(sapphireConfig.mainnet.runtimeId))
  const nonce = await accountsWrapper
    .queryNonce()
    .setArgs({ address: oasis.staking.addressFromBech32(oasisAddress) })
    .query(nic)
  return nonce
}

/**
 * @param {`0x${string}`} ethAddress
 */
async function getSapphireBalance(ethAddress) {
  const nic = new oasis.client.NodeInternal('https://grpc.oasis.io')
  const consensusWrapper = new oasisRT.consensusAccounts.Wrapper(
    oasis.misc.fromHex(sapphireConfig.mainnet.runtimeId),
  )
  const underlyingAddress = await oasis.address.fromData(
    oasisRT.address.V0_SECP256K1ETH_CONTEXT_IDENTIFIER,
    oasisRT.address.V0_SECP256K1ETH_CONTEXT_VERSION,
    oasis.misc.fromHex(ethAddress.replace('0x', '')),
  )

  const balanceResult = await consensusWrapper
    .queryBalance()
    .setArgs({
      address: underlyingAddress,
    })
    .query(nic)
  const balance = oasis.quantity.toBigInt(balanceResult.balance)
  return balance
}
