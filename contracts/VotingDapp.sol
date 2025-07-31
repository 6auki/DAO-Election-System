// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Election
 * @dev Individual election contract with upgradeable proxy pattern
 */
contract Election is Initializable, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable {
    
    // Enums
    enum ElectionStatus { NotStarted, Ongoing, Ended }
    enum VotingType { WinnerTakesAll, Leaderboard }
    
    // Election configuration
    struct ElectionConfig {
        string title;
        string description;
        uint256 startTime;
        uint256 endTime;
        uint256 candidateRegistrationDeadline;
        VotingType votingType;
        bool openCandidateRegistration;
        bool liveResultsEnabled;
        bool resultsPublic;
        bool useCommitReveal;
    }
    
    // Candidate structure
    struct Candidate {
        string name;
        string description;
        uint256 voteCount;
        bool isActive;
    }
    
    // Vote commit structure (for commit-reveal scheme)
    struct VoteCommit {
        bytes32 commitHash;
        bool hasCommitted;
        bool hasRevealed;
    }
    
    // State variables
    ElectionConfig public config;
    ElectionStatus public status;
    
    // Candidates
    uint256 public candidateCount;
    mapping(uint256 => Candidate) public candidates;
    mapping(string => bool) public candidateNameExists;
    mapping(address => bool) public isCandidateRegistered;
    
    // Voting
    mapping(address => bool) public hasVoted;
    mapping(address => bool) public isEligibleVoter;
    mapping(address => VoteCommit) public voteCommits;
    
    // Vote tracking
    uint256 public totalVotes;
    uint256 public totalEligibleVoters;
    uint256 public totalRegisteredVoters;
    
    // Reveal phase (for commit-reveal)
    uint256 public revealDeadline;
    bool public isRevealPhase;
    
    // Events
    event ElectionCreated(address indexed creator, string title);
    event ElectionStarted(uint256 startTime, uint256 endTime);
    event ElectionEnded(uint256 endTime);
    event CandidateRegistered(uint256 indexed candidateId, string name, address indexed registrant);
    event VoterRegistered(address indexed voter);
    event VoteCommitted(address indexed voter);
    event VoteRevealed(address indexed voter, uint256 candidateId);
    event VoteCast(address indexed voter, uint256 candidateId);
    event EmergencyStop(address indexed owner, uint256 timestamp);
    event ResultsEnabledAfterEmergency(address indexed owner);
    event ResultsDisabledAfterEmergency(address indexed owner);
    event RevealPhaseStarted(uint256 revealDeadline);
    
    // Modifiers
    modifier onlyDuringStatus(ElectionStatus _status) {
        require(getElectionStatus() == _status, "Invalid election status");
        _;
    }
    
    modifier onlyEligibleVoter() {
        require(isEligibleVoter[msg.sender], "Not eligible to vote");
        _;
    }
    
    modifier onlyBeforeCandidateDeadline() {
        require(block.timestamp < config.candidateRegistrationDeadline, "Candidate registration closed");
        _;
    }
    
    modifier onlyAfterElectionEnd() {
        require(block.timestamp > config.endTime, "Election still ongoing");
        _;
    }
    
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // initialize() is defined as upgradeable constructor
    // initializer modifier ensures this can only be called once (provided by OpenZeppelin)
    // _owner is the admin/owner of this election
    // __Ownable_init(_owner); - Initializes OpenZeppelin's Ownable contract logic. Sets the _owner as the contract’s owner.
    // __UUPSUpgradeable_init(); - Sets up internal upgrade support. Initializes internal state for UUPS upgradeability. Required by contracts that use the UUPS pattern for upgradeable logic.
    // __ReentrancyGuard_init(); - Initializes protection against reentrancy attacks.
    // config = _config; - Saves the passed _config struct to the contract’s state. (voting start and end times, voting type (WinnerTakesAll or Leaderboard), allow live results or not, public candidate registration or not, use of commit-reveal voting)
    // status = ElectionStatus.NotStarted; - Sets the initial status of the election.
    // candidateCount = 0; - Initializes the number of candidates to 0. As candidates register (or are added), this value will increment.
    /**
     * @dev Initialize the election contract
     */
    function initialize(
        address _owner,
        ElectionConfig memory _config,
        VoterEligibilityMode _voterEligibilityMode,
        uint256 _minimumTokenBalance,
        address _requiredNFTContract
    ) public initializer {
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        
        config = _config;
        status = ElectionStatus.NotStarted;
        candidateCount = 0;
        
        voterEligibilityMode = _voterEligibilityMode;
        minimumTokenBalance = _minimumTokenBalance;
        requiredNFTContract = _requiredNFTContract;
        
        // Set reveal deadline for commit-reveal scheme
        if (_config.useCommitReveal) {
            revealDeadline = _config.endTime + 1 days; // 24 hours to reveal
        }
        
        emit ElectionCreated(_owner, _config.title);
    }

    // when you upgrade, this function is called.
    // This is triggered automatically during each upgrade. Used to control who is allowed to upgrade the contract (usually only the owner)
    /**
     * @dev Authorize upgrade (only owner can upgrade)
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
    
    /**
     * @dev Get current election status based on time
     */
    function getElectionStatus() public view returns (ElectionStatus) {
        if (block.timestamp < config.startTime) {
            return ElectionStatus.NotStarted;
        } else if (block.timestamp <= config.endTime) {
            return ElectionStatus.Ongoing;
        } else {
            return ElectionStatus.Ended;
        }
    }
    
    /**
     * @dev Register a candidate
     */
    function registerCandidate(
        string memory _name,
        string memory _description
    ) external onlyBeforeCandidateDeadline {
        require(bytes(_name).length > 0, "Candidate name required");
        require(!candidateNameExists[_name], "Candidate name already exists");
        require(!isCandidateRegistered[msg.sender], "Already registered as candidate");
        
        if (!config.openCandidateRegistration) {
            require(msg.sender == owner(), "Only owner can register candidates");
        }
        
        uint256 candidateId = candidateCount++;
        candidates[candidateId] = Candidate({
            name: _name,
            description: _description,
            voteCount: 0,
            isActive: true
        });
        
        candidateNameExists[_name] = true;
        isCandidateRegistered[msg.sender] = true;
        
        emit CandidateRegistered(candidateId, _name, msg.sender);
    }
    
    // Voter eligibility modes
    enum VoterEligibilityMode { 
        Whitelist,           // Owner adds specific addresses
        OpenRegistration,    // Anyone can register to vote
        TokenBased,          // Must hold minimum tokens
        NFTBased            // Must own specific NFT
    }
    
    VoterEligibilityMode public voterEligibilityMode;
    uint256 public minimumTokenBalance;  // For token-based eligibility
    address public requiredNFTContract;  // For NFT-based eligibility
    mapping(address => bool) public hasRegisteredToVote;
    
    /**
     * @dev Add eligible voters (only owner, only for whitelist mode)
     */
    function addEligibleVoters(address[] memory _voters) external onlyOwner {
        require(voterEligibilityMode == VoterEligibilityMode.Whitelist, "Only for whitelist mode");
        require(getElectionStatus() == ElectionStatus.NotStarted, "Cannot modify voters after election starts");
        
        for (uint256 i = 0; i < _voters.length; i++) {
            if (!isEligibleVoter[_voters[i]]) {
                isEligibleVoter[_voters[i]] = true;
                totalEligibleVoters++;
            }
        }
    }
    
    /**
     * @dev Remove eligible voters (only owner, only for whitelist mode)
     */
    function removeEligibleVoters(address[] memory _voters) external onlyOwner {
        require(voterEligibilityMode == VoterEligibilityMode.Whitelist, "Only for whitelist mode");
        require(getElectionStatus() == ElectionStatus.NotStarted, "Cannot modify voters after election starts");
        
        for (uint256 i = 0; i < _voters.length; i++) {
            if (isEligibleVoter[_voters[i]]) {
                isEligibleVoter[_voters[i]] = false;
                totalEligibleVoters--;
            }
        }
    }
    
    /**
     * @dev Register to vote - different logic based on eligibility mode
     */
    function registerToVote() external {
        require(!hasRegisteredToVote[msg.sender], "Already registered");
        require(getElectionStatus() == ElectionStatus.NotStarted, "Registration closed");
        
        bool eligible = false;
        
        if (voterEligibilityMode == VoterEligibilityMode.Whitelist) {
            eligible = isEligibleVoter[msg.sender];
        } 
        else if (voterEligibilityMode == VoterEligibilityMode.OpenRegistration) {
            eligible = true;
            isEligibleVoter[msg.sender] = true;
            totalEligibleVoters++;
        }
        else if (voterEligibilityMode == VoterEligibilityMode.TokenBased) {
            // Assume we have an ERC20 token interface
            // eligible = IERC20(tokenContract).balanceOf(msg.sender) >= minimumTokenBalance;
            // For now, simplified:
            eligible = true; // Would need token contract integration
            isEligibleVoter[msg.sender] = true;
            totalEligibleVoters++;
        }
        else if (voterEligibilityMode == VoterEligibilityMode.NFTBased) {
            // Assume we have an ERC721 interface
            // eligible = IERC721(requiredNFTContract).balanceOf(msg.sender) > 0;
            // For now, simplified:
            eligible = true; // Would need NFT contract integration
            isEligibleVoter[msg.sender] = true;
            totalEligibleVoters++;
        }
        
        require(eligible, "Not eligible to vote");
        
        hasRegisteredToVote[msg.sender] = true;
        totalRegisteredVoters++;
        
        emit VoterRegistered(msg.sender);
    }
    
    /**
     * @dev Commit vote (for commit-reveal scheme)
     */
    function commitVote(bytes32 _commitHash) external 
        onlyDuringStatus(ElectionStatus.Ongoing) 
        onlyEligibleVoter 
        nonReentrant 
    {
        require(config.useCommitReveal, "Commit-reveal not enabled");
        require(!voteCommits[msg.sender].hasCommitted, "Already committed");
        require(!hasVoted[msg.sender], "Already voted");
        
        voteCommits[msg.sender] = VoteCommit({
            commitHash: _commitHash,
            hasCommitted: true,
            hasRevealed: false
        });
        
        emit VoteCommitted(msg.sender);
    }
    
    /**
     * @dev Reveal vote (for commit-reveal scheme)
     */
    function revealVote(uint256 _candidateId, uint256 _nonce) external 
        onlyAfterElectionEnd 
        onlyEligibleVoter 
        nonReentrant 
    {
        require(config.useCommitReveal, "Commit-reveal not enabled");
        require(block.timestamp <= revealDeadline, "Reveal phase ended");
        require(voteCommits[msg.sender].hasCommitted, "No commit found");
        require(!voteCommits[msg.sender].hasRevealed, "Already revealed");
        require(_candidateId < candidateCount, "Invalid candidate");
        require(candidates[_candidateId].isActive, "Candidate not active");
        
        // Verify commit
        bytes32 hash = keccak256(abi.encodePacked(_candidateId, _nonce, msg.sender));
        require(hash == voteCommits[msg.sender].commitHash, "Invalid reveal");
        
        voteCommits[msg.sender].hasRevealed = true;
        hasVoted[msg.sender] = true;
        candidates[_candidateId].voteCount++;
        totalVotes++;
        
        emit VoteRevealed(msg.sender, _candidateId);
    }
    
    /**
     * @dev Cast vote directly (non-commit-reveal)
     */
    function vote(uint256 _candidateId) external 
        onlyDuringStatus(ElectionStatus.Ongoing) 
        onlyEligibleVoter 
        nonReentrant 
    {
        require(!config.useCommitReveal, "Use commit-reveal scheme");
        require(!hasVoted[msg.sender], "Already voted");
        require(_candidateId < candidateCount, "Invalid candidate");
        require(candidates[_candidateId].isActive, "Candidate not active");
        
        hasVoted[msg.sender] = true;
        candidates[_candidateId].voteCount++;
        totalVotes++;
        
        emit VoteCast(msg.sender, _candidateId);
    }
    
    /**
     * @dev Start reveal phase (only owner, only after election ends)
     */
    function startRevealPhase() external onlyOwner onlyAfterElectionEnd {
        require(config.useCommitReveal, "Commit-reveal not enabled");
        require(!isRevealPhase, "Reveal phase already started");
        
        isRevealPhase = true;
        emit RevealPhaseStarted(revealDeadline);
    }
    
    /**
     * @dev Get election results
     */
    function getResults() external view returns (
        uint256[] memory candidateIds,
        string[] memory candidateNames,
        uint256[] memory voteCounts,
        uint256 totalVoteCount,
        uint256 participationRate
    ) {
        // Check if results should be visible
        bool canViewResults = config.resultsPublic || 
                            (config.liveResultsEnabled && getElectionStatus() == ElectionStatus.Ongoing) ||
                            (getElectionStatus() == ElectionStatus.Ended && !isEmergencyStopped) ||
                            (isEmergencyStopped && allowResultsAfterEmergency) ||
                            msg.sender == owner();
        
        require(canViewResults, "Results not available");
        
        candidateIds = new uint256[](candidateCount);
        candidateNames = new string[](candidateCount);
        voteCounts = new uint256[](candidateCount);
        
        for (uint256 i = 0; i < candidateCount; i++) {
            if (candidates[i].isActive) {
                candidateIds[i] = i;
                candidateNames[i] = candidates[i].name;
                voteCounts[i] = candidates[i].voteCount;
            }
        }
        
        totalVoteCount = totalVotes;
        participationRate = totalEligibleVoters > 0 ? 
            (totalVotes * 100) / totalEligibleVoters : 0;
    }
    
    /**
     * @dev Get winner (for WinnerTakesAll type)
     */
    function getWinner() external view returns (uint256 winnerId, string memory winnerName, uint256 winnerVotes) {
        require(getElectionStatus() == ElectionStatus.Ended, "Election not ended");
        require(config.votingType == VotingType.WinnerTakesAll, "Not a winner-takes-all election");
        
        uint256 maxVotes = 0;
        uint256 winnerIndex = 0;
        
        for (uint256 i = 0; i < candidateCount; i++) {
            if (candidates[i].isActive && candidates[i].voteCount > maxVotes) {
                maxVotes = candidates[i].voteCount;
                winnerIndex = i;
            }
        }
        
        return (winnerIndex, candidates[winnerIndex].name, maxVotes);
    }
    
    /**
     * @dev Get leaderboard (for Leaderboard type)
     */
    function getLeaderboard() external view returns (
        uint256[] memory candidateIds,
        string[] memory candidateNames,
        uint256[] memory voteCounts
    ) {
        require(getElectionStatus() == ElectionStatus.Ended, "Election not ended");
        require(config.votingType == VotingType.Leaderboard, "Not a leaderboard election");
        
        // Simple bubble sort for leaderboard (gas inefficient for large datasets)
        uint256[] memory sortedIds = new uint256[](candidateCount);
        string[] memory sortedNames = new string[](candidateCount);
        uint256[] memory sortedVotes = new uint256[](candidateCount);
        
        // Initialize arrays
        for (uint256 i = 0; i < candidateCount; i++) {
            sortedIds[i] = i;
            sortedNames[i] = candidates[i].name;
            sortedVotes[i] = candidates[i].voteCount;
        }
        
        // Sort by vote count (descending)
        for (uint256 i = 0; i < candidateCount - 1; i++) {
            for (uint256 j = 0; j < candidateCount - i - 1; j++) {
                if (sortedVotes[j] < sortedVotes[j + 1]) {
                    // Swap votes
                    uint256 tempVotes = sortedVotes[j];
                    sortedVotes[j] = sortedVotes[j + 1];
                    sortedVotes[j + 1] = tempVotes;
                    
                    // Swap ids
                    uint256 tempId = sortedIds[j];
                    sortedIds[j] = sortedIds[j + 1];
                    sortedIds[j + 1] = tempId;
                    
                    // Swap names
                    string memory tempName = sortedNames[j];
                    sortedNames[j] = sortedNames[j + 1];
                    sortedNames[j + 1] = tempName;
                }
            }
        }
        
        return (sortedIds, sortedNames, sortedVotes);
    }
    
    /**
     * @dev Get candidate details
     */
    function getCandidate(uint256 _candidateId) external view returns (
        string memory name,
        string memory description,
        uint256 voteCount,
        bool isActive
    ) {
        require(_candidateId < candidateCount, "Invalid candidate ID");
        Candidate memory candidate = candidates[_candidateId];
        return (candidate.name, candidate.description, candidate.voteCount, candidate.isActive);
    }
    
    /**
     * @dev Update election settings (only owner, only before start)
     */
    function updateElectionSettings(
        string memory _title,
        string memory _description,
        uint256 _startTime,
        uint256 _endTime,
        uint256 _candidateRegistrationDeadline,
        VotingType _votingType,
        VoterEligibilityMode _voterEligibilityMode,
        uint256 _minimumTokenBalance,
        address _requiredNFTContract,
        bool _openCandidateRegistration,
        bool _liveResultsEnabled,
        bool _resultsPublic,
        bool _useCommitReveal
    ) external onlyOwner onlyDuringStatus(ElectionStatus.NotStarted) {
        require(_startTime > block.timestamp, "Start time must be in future");
        require(_endTime > _startTime, "End time must be after start time");
        require(_candidateRegistrationDeadline <= _startTime, "Candidate deadline must be before start");
        
        config.title = _title;
        config.description = _description;
        config.startTime = _startTime;
        config.endTime = _endTime;
        config.candidateRegistrationDeadline = _candidateRegistrationDeadline;
        config.votingType = _votingType;
        config.openCandidateRegistration = _openCandidateRegistration;
        config.liveResultsEnabled = _liveResultsEnabled;
        config.resultsPublic = _resultsPublic;
        config.useCommitReveal = _useCommitReveal;
        
        voterEligibilityMode = _voterEligibilityMode;
        minimumTokenBalance = _minimumTokenBalance;
        requiredNFTContract = _requiredNFTContract;
        
        // Update reveal deadline if commit-reveal is enabled
        if (_useCommitReveal) {
            revealDeadline = _endTime + 1 days;
        }
    }
    
    // Emergency controls
    bool public isEmergencyStopped;
    bool public allowResultsAfterEmergency;
    
    /**
     * @dev Emergency stop election (only owner)
     */
    function emergencyStop() external onlyOwner {
        require(!isEmergencyStopped, "Already emergency stopped");
        
        config.endTime = block.timestamp;
        status = ElectionStatus.Ended;
        isEmergencyStopped = true;
        allowResultsAfterEmergency = false; // By default, hide results after emergency stop
        
        emit ElectionEnded(block.timestamp);
        emit EmergencyStop(msg.sender, block.timestamp);
    }
    
    /**
     * @dev Enable results viewing after emergency stop (only owner)
     */
    function enableResultsAfterEmergency() external onlyOwner {
        require(isEmergencyStopped, "Not emergency stopped");
        allowResultsAfterEmergency = true;
        emit ResultsEnabledAfterEmergency(msg.sender);
    }
    
    /**
     * @dev Disable results viewing after emergency stop (only owner)
     */
    function disableResultsAfterEmergency() external onlyOwner {
        require(isEmergencyStopped, "Not emergency stopped");
        allowResultsAfterEmergency = false;
        emit ResultsDisabledAfterEmergency(msg.sender);
    }
}

/**
 * @title ElectionFactory
 * @dev Factory contract for creating election proxies
 */
contract ElectionFactory is Ownable {
    
    address public electionImplementation;
    uint256 public electionCount;
    
    mapping(uint256 => address) public elections;
    mapping(address => uint256[]) public creatorElections;
    
    event ElectionImplementationUpdated(address indexed newImplementation);
    event ElectionCreated(
        uint256 indexed electionId,
        address indexed electionAddress,
        address indexed creator,
        string title
    );
    
    constructor(address _electionImplementation) Ownable(msg.sender) {
        electionImplementation = _electionImplementation;
    }
    
    /**
     * @dev Create a new election
     */
    function createElection(
        Election.ElectionConfig memory _config,
        Election.VoterEligibilityMode _voterEligibilityMode,
        uint256 _minimumTokenBalance,
        address _requiredNFTContract
    ) external returns (address electionAddress) {
        require(bytes(_config.title).length > 0, "Title required");
        require(_config.startTime > block.timestamp, "Start time must be in future");
        require(_config.endTime > _config.startTime, "End time must be after start time");
        require(_config.candidateRegistrationDeadline <= _config.startTime, "Candidate deadline must be before start");
        
        // Create proxy
        bytes memory initData = abi.encodeCall(
            Election.initialize,
            (msg.sender, _config, _voterEligibilityMode, _minimumTokenBalance, _requiredNFTContract)
        );
        
        ERC1967Proxy proxy = new ERC1967Proxy(electionImplementation, initData);
        electionAddress = address(proxy);
        
        uint256 electionId = electionCount++;
        elections[electionId] = electionAddress;
        creatorElections[msg.sender].push(electionId);
        
        emit ElectionCreated(electionId, electionAddress, msg.sender, _config.title);
        
        return electionAddress;
    }
    
    /**
     * @dev Update election implementation (only owner)
     */
    function updateElectionImplementation(address _newImplementation) external onlyOwner {
        electionImplementation = _newImplementation;
        emit ElectionImplementationUpdated(_newImplementation);
    }
    
    /**
     * @dev Get all elections
     */
    function getAllElections() external view returns (address[] memory) {
        address[] memory allElections = new address[](electionCount);
        for (uint256 i = 0; i < electionCount; i++) {
            allElections[i] = elections[i];
        }
        return allElections;
    }
    
    /**
     * @dev Get elections created by a specific address
     */
    function getCreatorElections(address _creator) external view returns (uint256[] memory) {
        return creatorElections[_creator];
    }
    
    /**
     * @dev Get election address by ID
     */
    function getElectionAddress(uint256 _electionId) external view returns (address) {
        require(_electionId < electionCount, "Invalid election ID");
        return elections[_electionId];
    }
}