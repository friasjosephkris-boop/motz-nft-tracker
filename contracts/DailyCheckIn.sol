// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Daily Check In
/// @notice Records on-chain daily check-ins for users. The relayer (owner)
///         calls checkIn(user) once per period per user. The contract enforces
///         per-period limits and prevents double check-ins in the same period.
///         Periods are fixed 24-hour windows starting at periodStartTimeInUTC
///         seconds-of-day (e.g. 0 = 00:00 UTC reset).
contract DailyCheckIn {
    // ---- Ownership (minimal Ownable, no external deps) ----
    address public owner;
    event OwnershipTransferred(address indexed from, address indexed to);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function renounceOwnership() external onlyOwner {
        emit OwnershipTransferred(owner, address(0));
        owner = address(0);
    }

    // ---- Daily Check In state ----

    /// @notice Max number of check-ins the relayer can submit per period.
    ///         Acts as a rate limit / fraud guard. Owner-adjustable.
    uint256 public limitDailyCheckIn;

    /// @notice Seconds-of-day offset for when the daily period boundary starts.
    ///         0 = 00:00 UTC reset. Set at construction; not adjustable.
    uint256 public immutable periodStartTimeInUTC;

    /// @notice Last period the relayer checked-in each user, stored as
    ///         (periodId + 1) so a value of 0 unambiguously means "never
    ///         checked in." Avoids confusion when the contract is deployed
    ///         during period 0.
    mapping(address => uint256) private _lastCheckInPeriodPlusOne;

    /// @notice Public view: actual last period checked-in (0 = never).
    ///         Returns 0 for never-checked users and the real periodId for others.
    function lastCheckInPeriod(address user) external view returns (uint256) {
        uint256 v = _lastCheckInPeriodPlusOne[user];
        return v == 0 ? 0 : v - 1;
    }

    /// @notice True if user has ever checked in.
    function hasEverCheckedIn(address user) public view returns (bool) {
        return _lastCheckInPeriodPlusOne[user] != 0;
    }

    /// @notice How many check-ins the relayer has submitted in the given
    ///         period (periodId => count). Enforces limitDailyCheckIn.
    mapping(uint256 => uint256) public checkInsThisPeriod;

    /// @notice Streak of consecutive periods a user has checked-in.
    mapping(address => uint256) public streak;

    event CheckIn(address indexed user, uint256 indexed periodId, uint256 streak, uint256 timestamp);
    event LimitDailyCheckInUpdated(uint256 oldLimit, uint256 newLimit);

    constructor(address _owner, uint256 _limitDailyCheckIn, uint256 _periodStartTimeInUTC) {
        require(_owner != address(0), "zero owner");
        require(_periodStartTimeInUTC < 86400, "periodStart must be < 86400s");
        owner = _owner;
        limitDailyCheckIn = _limitDailyCheckIn;
        periodStartTimeInUTC = _periodStartTimeInUTC;
        emit OwnershipTransferred(address(0), _owner);
    }

    /// @notice Current period number based on block.timestamp. Periods are
    ///         24h windows starting at periodStartTimeInUTC seconds-of-day.
    function currentPeriodId() public view returns (uint256) {
        uint256 ts = block.timestamp;
        if (ts < periodStartTimeInUTC) return 0;
        return (ts - periodStartTimeInUTC) / 86400;
    }

    /// @notice Daily check-in for `user`. Called by the relayer (owner).
    /// @dev Requirements:
    ///      - caller is owner
    ///      - user has not already checked-in this period
    ///      - relayer has not exceeded limitDailyCheckIn this period
    function checkIn(address user) external onlyOwner {
        require(user != address(0), "zero user");
        uint256 pid = currentPeriodId();
        uint256 storedLastPlus1 = _lastCheckInPeriodPlusOne[user];

        // Block double check-in: if storedLast == pid we've already done this period.
        if (storedLastPlus1 != 0) {
            require(storedLastPlus1 - 1 != pid, "already checked in this period");
        }
        require(checkInsThisPeriod[pid] < limitDailyCheckIn, "daily limit reached");

        // Streak: increment if last check-in was the immediately preceding
        // period (consecutive day); otherwise reset to 1 (first day or gap).
        uint256 newStreak = 1;
        if (storedLastPlus1 != 0) {
            uint256 storedLast = storedLastPlus1 - 1;
            if (storedLast + 1 == pid) {
                newStreak = streak[user] + 1;
            }
        }

        _lastCheckInPeriodPlusOne[user] = pid + 1;
        streak[user] = newStreak;
        checkInsThisPeriod[pid] += 1;

        emit CheckIn(user, pid, newStreak, block.timestamp);
    }

    /// @notice Has `user` already checked-in this period?
    function hasCheckedInToday(address user) external view returns (bool) {
        uint256 v = _lastCheckInPeriodPlusOne[user];
        if (v == 0) return false;
        return v - 1 == currentPeriodId();
    }

    /// @notice Owner adjusts the per-period check-in cap.
    function setLimitDailyCheckIn(uint256 newLimit) external onlyOwner {
        emit LimitDailyCheckInUpdated(limitDailyCheckIn, newLimit);
        limitDailyCheckIn = newLimit;
    }
}
