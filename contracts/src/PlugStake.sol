// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title PlugStake
/// @notice Reputation staking vault for plugs using USDC.
/// @dev Staking is permissionless. Only the council can slash a plug's staked balance to a named victim.
contract PlugStake is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint64 public constant WITHDRAWAL_DELAY = 7 days;

    /// @notice USDC token used for staking.
    IERC20 public immutable USDC;

    address public council;
    address public proposedCouncil;

    struct WithdrawRequestData {
        uint256 amount;
        uint64 unlocksAt;
    }

    mapping(address plug => uint256 amount) private _stakeOf;
    mapping(address plug => WithdrawRequestData req) private _withdrawRequest;

    event Staked(address indexed plug, uint256 amount);
    event StakeAdded(address indexed plug, uint256 amount);
    event WithdrawRequested(address indexed plug, uint256 amount, uint64 unlocksAt);
    event WithdrawCompleted(address indexed plug, uint256 amount);
    event WithdrawCancelled(address indexed plug);
    event Slashed(address indexed plug, address indexed victim, uint256 amount, bytes32 dealId, bytes32 reason);
    event CouncilProposed(address indexed currentCouncil, address indexed proposedCouncil);
    event CouncilUpdated(address indexed previousCouncil, address indexed newCouncil);

    error ZeroAddress();
    error AmountZero();
    error NotCouncil();
    error NotProposedCouncil();
    error AlreadyStaked();
    error NoStake();
    error NoWithdrawRequest();
    error WithdrawAlreadyRequested();
    error WithdrawNotReady(uint64 unlocksAt);

    modifier onlyCouncil() {
        if (msg.sender != council) revert NotCouncil();
        _;
    }

    /// @notice Deploys the staking contract.
    /// @param usdc USDC token address used for staking and slashing transfers.
    /// @param initialCouncil Initial slash council address.
    constructor(IERC20 usdc, address initialCouncil) {
        if (address(usdc) == address(0) || initialCouncil == address(0)) revert ZeroAddress();
        USDC = usdc;
        council = initialCouncil;
    }

    /// @notice Stakes USDC for the caller. Also used to re-stake after a full withdrawal.
    /// @param amount Amount of USDC to stake.
    function stake(uint256 amount) external nonReentrant {
        if (amount == 0) revert AmountZero();
        // Re-staking after a completed withdrawal (stakeOf == 0) is allowed.
        // Calling stake() while already staked is rejected; use addStake() instead.
        if (_stakeOf[msg.sender] != 0) revert AlreadyStaked();

        _stakeOf[msg.sender] = amount;
        USDC.safeTransferFrom(msg.sender, address(this), amount);

        emit Staked(msg.sender, amount);
    }

    /// @notice Adds USDC to an existing stake without changing withdrawal unlock time.
    /// @param amount Amount of USDC to add.
    function addStake(uint256 amount) external nonReentrant {
        if (amount == 0) revert AmountZero();
        uint256 currentStake = _stakeOf[msg.sender];
        if (currentStake == 0) revert NoStake();

        _stakeOf[msg.sender] = currentStake + amount;

        WithdrawRequestData storage req = _withdrawRequest[msg.sender];
        if (req.unlocksAt != 0) {
            req.amount += amount;
        }

        USDC.safeTransferFrom(msg.sender, address(this), amount);

        emit StakeAdded(msg.sender, amount);
    }

    /// @notice Starts the 7-day withdrawal timer for the caller's current full stake.
    function requestWithdraw() external nonReentrant {
        uint256 currentStake = _stakeOf[msg.sender];
        if (currentStake == 0) revert NoStake();

        WithdrawRequestData storage req = _withdrawRequest[msg.sender];
        if (req.unlocksAt != 0) revert WithdrawAlreadyRequested();

        uint64 unlocksAt = uint64(block.timestamp + WITHDRAWAL_DELAY);
        req.amount = currentStake;
        req.unlocksAt = unlocksAt;

        emit WithdrawRequested(msg.sender, currentStake, unlocksAt);
    }

    /// @notice Completes a previously requested withdrawal after the delay and returns USDC to the caller.
    function completeWithdraw() external nonReentrant {
        WithdrawRequestData memory req = _withdrawRequest[msg.sender];
        if (req.unlocksAt == 0) revert NoWithdrawRequest();
        if (block.timestamp < req.unlocksAt) revert WithdrawNotReady(req.unlocksAt);

        delete _withdrawRequest[msg.sender];
        delete _stakeOf[msg.sender];

        USDC.safeTransfer(msg.sender, req.amount);

        emit WithdrawCompleted(msg.sender, req.amount);
    }

    /// @notice Proposes a new council address for two-step council transfer.
    /// @param newCouncil Address proposed to become the next council.
    function proposeNewCouncil(address newCouncil) external onlyCouncil nonReentrant {
        if (newCouncil == address(0)) revert ZeroAddress();
        proposedCouncil = newCouncil;
        emit CouncilProposed(council, newCouncil);
    }

    /// @notice Accepts the council role; callable only by the proposed council address.
    function acceptCouncil() external nonReentrant {
        if (msg.sender != proposedCouncil) revert NotProposedCouncil();
        address previous = council;
        council = msg.sender;
        proposedCouncil = address(0);
        emit CouncilUpdated(previous, msg.sender);
    }

    /// @notice Slashes a plug's staked balance and transfers slashed USDC to a named victim.
    /// @dev If the plug has a pending withdrawal request it is cancelled before slashing.
    /// @param plug Address being slashed.
    /// @param amount Requested slash amount. If above stake, entire stake is slashed.
    /// @param victim Recipient of slashed USDC.
    /// @param dealId Deal identifier associated with the slash.
    /// @param reason Reason code for the slash.
    function slash(address plug, uint256 amount, address victim, bytes32 dealId, bytes32 reason)
        external
        onlyCouncil
        nonReentrant
    {
        if (victim == address(0)) revert ZeroAddress();

        WithdrawRequestData memory req = _withdrawRequest[plug];
        if (req.unlocksAt != 0) {
            delete _withdrawRequest[plug];
            emit WithdrawCancelled(plug);
        }

        uint256 currentStake = _stakeOf[plug];
        uint256 slashAmount = amount > currentStake ? currentStake : amount;

        if (slashAmount != 0) {
            _stakeOf[plug] = currentStake - slashAmount;
            USDC.safeTransfer(victim, slashAmount);
        }

        emit Slashed(plug, victim, slashAmount, dealId, reason);
    }

    /// @notice Returns the current staked balance of a plug.
    /// @param plug Plug address.
    /// @return Current staked USDC balance.
    function stakeOf(address plug) external view returns (uint256) {
        return _stakeOf[plug];
    }

    /// @notice Returns the pending withdrawal request for a plug.
    /// @param plug Plug address.
    /// @return amount Pending withdrawal amount.
    /// @return unlocksAt Timestamp when withdrawal can be completed (0 if no request).
    function withdrawRequest(address plug) external view returns (uint256 amount, uint64 unlocksAt) {
        WithdrawRequestData memory req = _withdrawRequest[plug];
        return (req.amount, req.unlocksAt);
    }
}
