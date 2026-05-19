// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Gauntlet DailyCheckIn
 * @author Gauntlet Tower
 * @notice On-chain daily check-in for Gauntlet Tower. Burns gas, records a
 *         streak, and exposes the same surface as Ronin's Daily Check-In
 *         template so check-ins count toward Voyages rewards:
 *         checkIn(), getCurrentStreak(address), setLimitDailyCheckIn(uint256).
 *
 * @dev Day index = (block.timestamp - periodStartTimeInUTC) / 1 days.
 *      Streak only counts on a day the user has checked in. Miss a day and
 *      the next check-in restarts the streak at 1 — matching the template's
 *      semantic of getCurrentStreak returning 0 when today was missed.
 */
contract DailyCheckIn is Ownable {

    // ══════════════════════════════════════════════════
    //                    STORAGE
    // ══════════════════════════════════════════════════

    uint256 public constant PERIOD_DURATION = 1 days;

    /// @notice Unix timestamp where day index 0 begins. Set 0 (or 1) to align
    ///         day boundaries to UTC midnight.
    uint256 public periodStartTimeInUTC;

    /// @notice Maximum on-chain check-ins allowed per user per day.
    uint256 public limitDailyCheckIn;

    struct UserState {
        uint64  lastCheckInDay;  // day index of last check-in
        uint64  currentStreak;   // consecutive-day streak as of lastCheckInDay
        uint128 totalCheckIns;   // lifetime check-ins
    }

    mapping(address => UserState) public userState;
    mapping(address => mapping(uint256 => uint256)) public checkInsByDay;

    // ══════════════════════════════════════════════════
    //                    EVENTS & ERRORS
    // ══════════════════════════════════════════════════

    event CheckedIn(
        address indexed user,
        uint256 indexed day,
        uint256 streak,
        uint256 totalCheckIns
    );
    event LimitDailyCheckInUpdated(uint256 oldLimit, uint256 newLimit);

    error PeriodNotStarted();
    error DailyLimitReached();
    error InvalidLimit();

    // ══════════════════════════════════════════════════
    //                    CONSTRUCTOR
    // ══════════════════════════════════════════════════

    constructor(
        address initialOwner,
        uint256 limitDailyCheckIn_,
        uint256 periodStartTimeInUTC_
    ) Ownable(initialOwner) {
        if (limitDailyCheckIn_ == 0) revert InvalidLimit();
        limitDailyCheckIn = limitDailyCheckIn_;
        periodStartTimeInUTC = periodStartTimeInUTC_;
    }

    // ══════════════════════════════════════════════════
    //                    WRITE
    // ══════════════════════════════════════════════════

    function checkIn() external {
        uint256 today = _today();
        uint256 alreadyToday = checkInsByDay[msg.sender][today];
        if (alreadyToday >= limitDailyCheckIn) revert DailyLimitReached();

        UserState storage s = userState[msg.sender];

        if (alreadyToday == 0) {
            // First check-in of the day — update streak
            if (uint256(s.lastCheckInDay) + 1 == today) {
                s.currentStreak += 1;
            } else {
                s.currentStreak = 1;
            }
            s.lastCheckInDay = uint64(today);
        }

        checkInsByDay[msg.sender][today] = alreadyToday + 1;
        s.totalCheckIns += 1;

        emit CheckedIn(msg.sender, today, s.currentStreak, s.totalCheckIns);
    }

    function setLimitDailyCheckIn(uint256 newLimit) external onlyOwner {
        if (newLimit == 0) revert InvalidLimit();
        emit LimitDailyCheckInUpdated(limitDailyCheckIn, newLimit);
        limitDailyCheckIn = newLimit;
    }

    // ══════════════════════════════════════════════════
    //                    READ
    // ══════════════════════════════════════════════════

    /// @notice Matches the Ronin template: returns 0 if the user missed today.
    function getCurrentStreak(address user) external view returns (uint256) {
        UserState memory s = userState[user];
        uint256 today = _today();
        if (uint256(s.lastCheckInDay) != today) return 0;
        return uint256(s.currentStreak);
    }

    /// @notice Convenience for UI — true if the user has checked in today.
    function hasCheckedInToday(address user) external view returns (bool) {
        return checkInsByDay[user][_today()] > 0;
    }

    /// @notice Current day index — useful for "next check-in" countdown UI.
    function currentDay() external view returns (uint256) {
        return _today();
    }

    /// @notice Lifetime stats snapshot — does not zero the streak if today missed.
    function rawState(address user) external view returns (
        uint256 lastCheckInDay,
        uint256 currentStreak,
        uint256 totalCheckIns
    ) {
        UserState memory s = userState[user];
        return (s.lastCheckInDay, s.currentStreak, s.totalCheckIns);
    }

    // ══════════════════════════════════════════════════
    //                    INTERNAL
    // ══════════════════════════════════════════════════

    function _today() internal view returns (uint256) {
        if (block.timestamp < periodStartTimeInUTC) revert PeriodNotStarted();
        return (block.timestamp - periodStartTimeInUTC) / PERIOD_DURATION;
    }
}
