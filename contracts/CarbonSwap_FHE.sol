pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract CarbonSwap_FHE is ZamaEthereumConfig {
    struct CarbonCredit {
        string creditId;
        euint32 encryptedAmount;
        euint32 encryptedPrice;
        uint256 publicCompanyData;
        address owner;
        uint256 timestamp;
        uint32 decryptedAmount;
        uint32 decryptedPrice;
        bool isVerified;
    }

    mapping(string => CarbonCredit) public carbonCredits;
    string[] public creditIds;

    event CarbonCreditCreated(string indexed creditId, address indexed owner);
    event DecryptionVerified(string indexed creditId, uint32 amount, uint32 price);

    constructor() ZamaEthereumConfig() {}

    function createCarbonCredit(
        string calldata creditId,
        externalEuint32 encryptedAmount,
        bytes calldata amountProof,
        externalEuint32 encryptedPrice,
        bytes calldata priceProof,
        uint256 publicCompanyData
    ) external {
        require(bytes(carbonCredits[creditId].creditId).length == 0, "Credit ID already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedAmount, amountProof)), "Invalid encrypted amount");
        require(FHE.isInitialized(FHE.fromExternal(encryptedPrice, priceProof)), "Invalid encrypted price");

        carbonCredits[creditId] = CarbonCredit({
            creditId: creditId,
            encryptedAmount: FHE.fromExternal(encryptedAmount, amountProof),
            encryptedPrice: FHE.fromExternal(encryptedPrice, priceProof),
            publicCompanyData: publicCompanyData,
            owner: msg.sender,
            timestamp: block.timestamp,
            decryptedAmount: 0,
            decryptedPrice: 0,
            isVerified: false
        });

        FHE.allowThis(carbonCredits[creditId].encryptedAmount);
        FHE.allowThis(carbonCredits[creditId].encryptedPrice);
        FHE.makePubliclyDecryptable(carbonCredits[creditId].encryptedAmount);
        FHE.makePubliclyDecryptable(carbonCredits[creditId].encryptedPrice);

        creditIds.push(creditId);
        emit CarbonCreditCreated(creditId, msg.sender);
    }

    function verifyDecryption(
        string calldata creditId,
        bytes memory abiEncodedClearAmount,
        bytes memory abiEncodedClearPrice,
        bytes memory amountProof,
        bytes memory priceProof
    ) external {
        require(bytes(carbonCredits[creditId].creditId).length > 0, "Credit does not exist");
        require(!carbonCredits[creditId].isVerified, "Credit already verified");

        bytes32[] memory cts = new bytes32[](2);
        cts[0] = FHE.toBytes32(carbonCredits[creditId].encryptedAmount);
        cts[1] = FHE.toBytes32(carbonCredits[creditId].encryptedPrice);

        bytes[] memory proofs = new bytes[](2);
        proofs[0] = amountProof;
        proofs[1] = priceProof;

        FHE.checkSignatures(cts, abiEncodedClearAmount, abiEncodedClearPrice, proofs);

        uint32 decodedAmount = abi.decode(abiEncodedClearAmount, (uint32));
        uint32 decodedPrice = abi.decode(abiEncodedClearPrice, (uint32));

        carbonCredits[creditId].decryptedAmount = decodedAmount;
        carbonCredits[creditId].decryptedPrice = decodedPrice;
        carbonCredits[creditId].isVerified = true;

        emit DecryptionVerified(creditId, decodedAmount, decodedPrice);
    }

    function getEncryptedAmount(string calldata creditId) external view returns (euint32) {
        require(bytes(carbonCredits[creditId].creditId).length > 0, "Credit does not exist");
        return carbonCredits[creditId].encryptedAmount;
    }

    function getEncryptedPrice(string calldata creditId) external view returns (euint32) {
        require(bytes(carbonCredits[creditId].creditId).length > 0, "Credit does not exist");
        return carbonCredits[creditId].encryptedPrice;
    }

    function getCarbonCredit(string calldata creditId) external view returns (
        string memory creditId_,
        uint256 publicCompanyData,
        address owner,
        uint256 timestamp,
        bool isVerified,
        uint32 decryptedAmount,
        uint32 decryptedPrice
    ) {
        require(bytes(carbonCredits[creditId].creditId).length > 0, "Credit does not exist");
        CarbonCredit storage credit = carbonCredits[creditId];

        return (
            credit.creditId,
            credit.publicCompanyData,
            credit.owner,
            credit.timestamp,
            credit.isVerified,
            credit.decryptedAmount,
            credit.decryptedPrice
        );
    }

    function getAllCreditIds() external view returns (string[] memory) {
        return creditIds;
    }

    function swapCredits(
        string calldata creditId1,
        string calldata creditId2
    ) external {
        require(bytes(carbonCredits[creditId1].creditId).length > 0, "Credit 1 does not exist");
        require(bytes(carbonCredits[creditId2].creditId).length > 0, "Credit 2 does not exist");
        require(carbonCredits[creditId1].owner == msg.sender, "Not owner of credit 1");
        require(carbonCredits[creditId2].owner == msg.sender, "Not owner of credit 2");

        (carbonCredits[creditId1].owner, carbonCredits[creditId2].owner) = 
            (carbonCredits[creditId2].owner, carbonCredits[creditId1].owner);
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}


