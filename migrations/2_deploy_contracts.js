const BN = require('bn.js')

const Proxy = artifacts.require('DSProxy')
const ProxyFactory = artifacts.require('DSProxyFactory')
const ProxyRegistry = artifacts.require('ProxyRegistry')
const SaiProxyCreateAndExecute = artifacts.require('SaiProxyCreateAndExecute')

const GemFab = artifacts.require('GemFab')
const VoxFab = artifacts.require('VoxFab')
const TubFab = artifacts.require('TubFab')
const TapFab = artifacts.require('TapFab')
const TopFab = artifacts.require('TopFab')
const MomFab = artifacts.require('MomFab')
const DadFab = artifacts.require('DadFab')
const DaiFab = artifacts.require('DaiFab')

const Weth = artifacts.require('WETH')
const DsToken = artifacts.require('DSToken')
const PipDsValue = artifacts.require('PipDSValue')
const PepDsValue = artifacts.require('PepDSValue')
const DsRoles = artifacts.require('DSRoles')
const SaiMom = artifacts.require('SaiMom')
const SaiTub = artifacts.require('SaiTub')

const pointOneEthInWei = web3.utils.toWei('0.1', 'ether')
const oneEthInWei = web3.utils.toWei('1', 'ether')
const thousandEthInWei = web3.utils.toWei('1000', 'ether')

const saiProxyShutAbi = {
    "constant": false,
    "inputs": [
        {
            "name": "tub_",
            "type": "address"
        },
        {
            "name": "cup",
            "type": "bytes32"
        }
    ],
    "name": "shut",
    "outputs": [],
    "payable": false,
    "stateMutability": "nonpayable",
    "type": "function"
}

function numStringToBytes32(num) {
    var bn = new BN(num).toTwos(256);
    return padToBytes32(bn.toString(16));
}

function padToBytes32(n) {
    while (n.length < 64) {
        n = "0" + n;
    }
    return "0x" + n;
}

const getCupdIdsForLad = async (tub, lad) => {
    const maxCupId = await tub.cupi()
    const cupIdsBelongingToLad = []

    for (let cupId = 1; cupId <= maxCupId; cupId++) {
        const cupIdAsBytes32 = numStringToBytes32(cupId.toString())
        const cup = await tub.cups(cupIdAsBytes32)
        if (cup.lad === lad) {
            cupIdsBelongingToLad.push(cupIdAsBytes32)
        }
    }

    return cupIdsBelongingToLad
}

module.exports = async (deployer, network, accounts) => {

    const cdpOwner = accounts[0]

    // Deploy protocol
    await deployer.deploy(GemFab)
    await deployer.deploy(VoxFab)
    await deployer.deploy(TubFab)
    await deployer.deploy(TapFab)
    await deployer.deploy(TopFab)
    await deployer.deploy(MomFab)
    await deployer.deploy(DadFab)
    await deployer.deploy(DaiFab, GemFab.address, VoxFab.address, TubFab.address, TapFab.address,
        TopFab.address, MomFab.address, DadFab.address)

    await deployer.deploy(Weth)
    await deployer.deploy(DsToken, web3.utils.asciiToHex('GOV'))
    await deployer.deploy(PipDsValue)
    await deployer.deploy(PepDsValue)
    const pit = '0x0000000000000000000000000000000000000123'

    // Basic config
    const daiFab = await DaiFab.at(DaiFab.address)

    await daiFab.makeTokens()
    await daiFab.makeVoxTub(Weth.address, DsToken.address, PipDsValue.address, PepDsValue.address, pit)
    await daiFab.makeTapTop()

    await deployer.deploy(DsRoles)

    const authority = await DsRoles.at(DsRoles.address)
    await authority.setRootUser(cdpOwner, true)
    await daiFab.configParams()
    await daiFab.verifyParams()
    await daiFab.configAuth(authority.address)

    const mom = await SaiMom.at(await daiFab.mom())
    const gov = await DsToken.at(DsToken.address)
    const sai = await DsToken.at(await daiFab.sai())
    const tubAddress = await daiFab.tub()
    const tub = await SaiTub.at(tubAddress)

    const oneEthBytes32 = '0x0000000000000000000000000000000000000000000000000de0b6b3a7640000'

    const pipDsValue = await PipDsValue.at(PipDsValue.address)
    await pipDsValue.poke(oneEthBytes32)

    const pepDsValue = await PepDsValue.at(PepDsValue.address)
    await pepDsValue.poke(oneEthBytes32)

    await mom.setCap(thousandEthInWei)

    // Deploy Proxy
    await deployer.deploy(ProxyFactory)
    await deployer.deploy(ProxyRegistry, ProxyFactory.address)
    await deployer.deploy(SaiProxyCreateAndExecute)
    const saiProxyCreateAndExecute = await SaiProxyCreateAndExecute.at(SaiProxyCreateAndExecute.address)

    // Create CDP
    console.log("Dai balance before CDP created: " + await sai.balanceOf(cdpOwner))
    await saiProxyCreateAndExecute.createOpenLockAndDraw(ProxyRegistry.address, tubAddress, pointOneEthInWei, {value: oneEthInWei})
    console.log("Dai balance after CDP created: " + await sai.balanceOf(cdpOwner))

    // Close CDP
    const proxyRegistry = await ProxyRegistry.at(ProxyRegistry.address)
    const proxyAddress = await proxyRegistry.proxies(cdpOwner)
    const proxy = await Proxy.at(proxyAddress)

    await gov.mint(cdpOwner, pointOneEthInWei)
    await gov.approve(proxy.address, thousandEthInWei)
    await sai.approve(proxy.address, thousandEthInWei)

    const cupIdsBelongingToProxy = await getCupdIdsForLad(tub, proxy.address)
    const cdpOwnerLatestCup = cupIdsBelongingToProxy[cupIdsBelongingToProxy.length - 1]

    console.log("MKR balance before CDP shut: " + await gov.balanceOf(cdpOwner))
    const functionCall = web3.eth.abi.encodeFunctionCall(saiProxyShutAbi, [tubAddress, cdpOwnerLatestCup])
    await proxy.execute(saiProxyCreateAndExecute.address, functionCall)
    console.log("MKR balance after CDP shut: " + await gov.balanceOf(cdpOwner))
    console.log("Dai balance after CDP shut: " + await sai.balanceOf(cdpOwner))
}