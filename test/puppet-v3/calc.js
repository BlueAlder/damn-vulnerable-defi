const { ethers } = require('hardhat');

let weth_token0_reserve = ethers.utils.parseEther("10")
let dvt_token1_reserve = ethers.utils.parseEther("10")

const calcLiquidity = (x, y) => {
  return Math.sqrt(x * y)
}

const deltaSqrtP = (deltaY, L) => {
  return deltaY / L
}

let L = calcLiquidity(weth_token0_reserve, dvt_token1_reserve)
console.log(L);