import React, { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { 
  Vote, 
  Users, 
  Clock, 
  Award, 
  Settings, 
  Plus, 
  Search,
  Filter,
  Wallet,
  AlertCircle,
  CheckCircle,
  Calendar,
  BarChart3,
  Eye,
  Lock,
  Unlock,
  X,
  User,
  TrendingUp
} from 'lucide-react';

// Contract ABIs (simplified for demo)
const ELECTION_FACTORY_ABI = [
  "function createElection((string,string,uint256,uint256,uint256,uint8,bool,bool,bool,bool), uint8, uint256, address) external returns (address)",
  "function getAllElections() external view returns (address[])",
  "function getCreatorElections(address) external view returns (uint256[])",
  "function electionCount() external view returns (uint256)",
  "function elections(uint256) external view returns (address)",
  "event ElectionCreated(uint256 indexed electionId, address indexed electionAddress, address indexed creator, string title)"
];

const ELECTION_ABI = [
  "function config() external view returns (string,string,uint256,uint256,uint256,uint8,bool,bool,bool,bool)",
  "function getElectionStatus() external view returns (uint8)",
  "function candidateCount() external view returns (uint256)",
  "function candidates(uint256) external view returns (string,string,uint256,bool)",
  "function registerCandidate(string,string) external",
  "function registerToVote() external",
  "function vote(uint256) external",
  "function commitVote(bytes32) external",
  "function revealVote(uint256,uint256) external",
  "function getResults() external view returns (uint256[],string[],uint256[],uint256,uint256)",
  "function getWinner() external view returns (uint256,string,uint256)",
  "function hasVoted(address) external view returns (bool)",
  "function isEligibleVoter(address) external view returns (bool)",
  "function totalVotes() external view returns (uint256)",
  "function totalEligibleVoters() external view returns (uint256)",
  "event VoteCast(address indexed voter, uint256 candidateId)",
  "event CandidateRegistered(uint256 indexed candidateId, string name, address indexed registrant)"
];

// Mock contract addresses (replace with actual deployed addresses)
const FACTORY_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

const ElectionDApp = () => {
  // State management
  const [account, setAccount] = useState('');
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [elections, setElections] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [selectedElection, setSelectedElection] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Modal states
  const [showElectionModal, setShowElectionModal] = useState(false);
  const [showVoteConfirmModal, setShowVoteConfirmModal] = useState(false);
  const [showVotedCandidateModal, setShowVotedCandidateModal] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState(null);

  // User voting state
  const [userVotes, setUserVotes] = useState({}); // { electionId: candidateId }
  const [candidateVotes, setCandidateVotes] = useState({}); // { electionId: { candidateId: extraVotes } }

  // Form states
  const [createElectionForm, setCreateElectionForm] = useState({
    title: '',
    description: '',
    startTime: '',
    endTime: '',
    candidateDeadline: '',
    votingType: '0',
    eligibilityMode: '1',
    minimumTokenBalance: '0',
    requiredNFTContract: '0x0000000000000000000000000000000000000000',
    openCandidateRegistration: true,
    liveResultsEnabled: false,
    resultsPublic: true,
    useCommitReveal: false
  });

  const [candidateForm, setCandidateForm] = useState({
    name: '',
    description: ''
  });

  // Mock candidates data
  const getCandidatesForElection = (electionId) => {
    const candidatesData = {
      1: [
        { id: 0, name: 'Alice Johnson', description: 'Experienced leader with focus on student welfare', votes: 234, avatar: '👩‍💼' },
        { id: 1, name: 'Bob Smith', description: 'Advocate for better facilities and academic programs', votes: 189, avatar: '👨‍🎓' },
        { id: 2, name: 'Carol Davis', description: 'Champion of diversity and inclusion initiatives', votes: 156, avatar: '👩‍🔬' },
        { id: 3, name: 'David Wilson', description: 'Focus on technology integration and innovation', votes: 145, avatar: '👨‍💻' },
        { id: 4, name: 'Eva Brown', description: 'Environmental sustainability and campus green initiatives', votes: 123, avatar: '👩‍🌾' }
      ],
      2: [
        { id: 0, name: 'Michael Chen', description: 'Financial transparency and community development', votes: 456, avatar: '👨‍💼' },
        { id: 1, name: 'Sarah Williams', description: 'Education and youth programs advocate', votes: 389, avatar: '👩‍🏫' },
        { id: 2, name: 'James Rodriguez', description: 'Infrastructure and public safety focus', votes: 400, avatar: '👨‍🚒' }
      ],
      3: [
        { id: 0, name: 'Dr. Amanda Foster', description: 'Former CEO with 20+ years corporate experience', votes: 234, avatar: '👩‍⚕️' },
        { id: 1, name: 'Robert Kim', description: 'Tech entrepreneur and innovation strategist', votes: 99, avatar: '👨‍💼' },
        { id: 2, name: 'Lisa Thompson', description: 'Financial expert and sustainable growth advocate', votes: 200, avatar: '👩‍💼' },
        { id: 3, name: 'Carlos Martinez', description: 'Marketing director with global experience', votes: 50, avatar: '👨‍🎨' }
      ]
    };
    // Add extra votes from candidateVotes state
    const extraVotes = candidateVotes[electionId] || {};
    return (candidatesData[electionId] || []).map(candidate => ({
      ...candidate,
      votes: candidate.votes + (extraVotes[candidate.id] || 0)
    }));
  };
  
  // Connect wallet
  const connectWallet = async () => {
    try {
      if (typeof window.ethereum !== 'undefined') {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const accounts = await provider.send("eth_requestAccounts", []);
        const signer = await provider.getSigner();
        
        setAccount(accounts[0]);
        setProvider(provider);
        setSigner(signer);
        
        // Load elections
        await loadElections(provider);
      } else {
        alert('Please install MetaMask!');
      }
    } catch (error) {
      console.error('Error connecting wallet:', error);
    }
  };

  // Load elections from factory
  const loadElections = async (web3Provider = provider) => {
    if (!web3Provider) return;
    
    setLoading(true);
    try {
      // In a real app, you would fetch from the actual contract
      // This is mock data for demonstration
      const mockElections = [
        {
          id: 1,
          address: '0xabc123...',
          title: 'Student Council Elections 2025',
          description: 'Vote for your preferred candidates for the upcoming student council positions.',
          status: 1, // Ongoing
          candidates: 5,
          totalVotes: 847,
          participation: 73,
          endTime: Date.now() + 2 * 24 * 60 * 60 * 1000, // 2 days from now
          creator: '0x1234...',
          votingType: 0,
          liveResults: true
        },
        {
          id: 2,
          address: '0xdef456...',
          title: 'Community Governance Vote',
          description: 'Decision on the new community center funding proposal.',
          status: 2, // Ended
          candidates: 3,
          totalVotes: 1245,
          participation: 87,
          endTime: Date.now() - 24 * 60 * 60 * 1000, // 1 day ago
          creator: '0x5678...',
          votingType: 0, // Winner Takes All
          liveResults: false
        },
        {
          id: 3,
          address: '0xghi789...',
          title: 'Board of Directors Election',
          description: 'Annual election for board positions. Token holders eligible to vote.',
          status: 2, // Ended
          candidates: 4,
          totalVotes: 892,
          participation: 74,
          endTime: Date.now() - 12 * 60 * 60 * 1000, // 12 hours ago
          creator: '0x9abc...',
          votingType: 1, // Leaderboard
          liveResults: false
        },
        {
          id: 4,
          address: '0xjkl012...',
          title: 'Technology Committee Selection',
          description: 'Choose representatives for the new technology oversight committee.',
          status: 0, // Not started
          candidates: 6,
          totalVotes: 0,
          participation: 0,
          endTime: Date.now() + 5 * 24 * 60 * 60 * 1000, // 5 days from now
          creator: '0xdef9...',
          votingType: 0,
          liveResults: true
        }
      ];
      
      setElections(mockElections);
    } catch (error) {
      console.error('Error loading elections:', error);
    }
    setLoading(false);
  };

  // View election details
  const viewElectionDetails = (election) => {
    setSelectedElection(election);
    setShowElectionModal(true);
  };

  // Initiate vote process
  const initiateVote = (candidate, election) => {
    setSelectedCandidate(candidate);
    setSelectedElection(election);
    setShowVoteConfirmModal(true);
  };

  // Confirm and cast vote
  const confirmVote = async () => {
    if (!selectedCandidate || !selectedElection || !account) return;
    
    setLoading(true);
    setShowVoteConfirmModal(false);
    
    try {
      // In a real app, you would call the actual contract
      console.log(`Voting for candidate ${selectedCandidate.id} (${selectedCandidate.name}) in election ${selectedElection.address}`);
      
      // Simulate transaction delay
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Record the vote
      setUserVotes(prev => ({
        ...prev,
        [selectedElection.id]: selectedCandidate.id
      }));
      
      // Increment candidate's vote count
      setCandidateVotes(prev => ({
        ...prev,
        [selectedElection.id]: {
          ...prev[selectedElection.id],
          [selectedCandidate.id]: (prev[selectedElection.id]?.[selectedCandidate.id] || 0) + 1
        }
      }));
      
      // Update election total votes
      setElections(prev => prev.map(election => 
        election.id === selectedElection.id 
          ? { ...election, totalVotes: election.totalVotes + 1 }
          : election
      ));
      
      alert(`Vote cast successfully for ${selectedCandidate.name}!`);
      
    } catch (error) {
      console.error('Error voting:', error);
      alert('Error voting: ' + error.message);
    }
    
    setLoading(false);
    setSelectedCandidate(null);
    setSelectedElection(null);
    setShowElectionModal(false);
  };

  // Check if user has voted in an election
  const hasUserVoted = (electionId) => {
    return userVotes[electionId] !== undefined;
  };

  // Get the candidate the user voted for
  const getUserVotedCandidate = (electionId) => {
    const candidateId = userVotes[electionId];
    if (candidateId === undefined) return null;
    const candidates = getCandidatesForElection(electionId);
    return candidates.find(c => c.id === candidateId);
  };

  // Create new election
  const createElection = async (e) => {
    e.preventDefault();
    if (!signer) return;
    
    setLoading(true);
    try {
      // Convert form data to contract format
      const config = {
        title: createElectionForm.title,
        description: createElectionForm.description,
        startTime: Math.floor(new Date(createElectionForm.startTime).getTime() / 1000),
        endTime: Math.floor(new Date(createElectionForm.endTime).getTime() / 1000),
        candidateRegistrationDeadline: Math.floor(new Date(createElectionForm.candidateDeadline).getTime() / 1000),
        votingType: parseInt(createElectionForm.votingType),
        openCandidateRegistration: createElectionForm.openCandidateRegistration,
        liveResultsEnabled: createElectionForm.liveResultsEnabled,
        resultsPublic: createElectionForm.resultsPublic,
        useCommitReveal: createElectionForm.useCommitReveal
      };

      // In a real app, you would call the actual contract
      console.log('Creating election with config:', config);
      
      // Mock success
      alert('Election created successfully! (This is a demo)');
      setActiveTab('dashboard');
      
      // Reset form
      setCreateElectionForm({
        title: '',
        description: '',
        startTime: '',
        endTime: '',
        candidateDeadline: '',
        votingType: '0',
        eligibilityMode: '1',
        minimumTokenBalance: '0',
        requiredNFTContract: '0x0000000000000000000000000000000000000000',
        openCandidateRegistration: true,
        liveResultsEnabled: false,
        resultsPublic: true,
        useCommitReveal: false
      });
      
      // Reload elections
      await loadElections();
    } catch (error) {
      console.error('Error creating election:', error);
      alert('Error creating election: ' + error.message);
    }
    setLoading(false);
  };

  // Register as candidate
  const registerCandidate = async (electionAddress) => {
    if (!signer || !candidateForm.name) return;
    
    setLoading(true);
    try {
      // In a real app, you would call the actual contract
      console.log(`Registering candidate: ${candidateForm.name} in election ${electionAddress}`);
      
      // Mock success
      alert('Candidate registered successfully! (This is a demo)');
      
      setCandidateForm({ name: '', description: '' });
      await loadElections();
    } catch (error) {
      console.error('Error registering candidate:', error);
      alert('Error registering candidate: ' + error.message);
    }
    setLoading(false);
  };

  // Filter elections
  const filteredElections = elections.filter(election => {
    const matchesSearch = election.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         election.description.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = !statusFilter || 
      (statusFilter === 'ongoing' && election.status === 1) ||
      (statusFilter === 'ended' && election.status === 2) ||
      (statusFilter === 'not-started' && election.status === 0);
    
    return matchesSearch && matchesStatus;
  });

  // Get status info
  const getStatusInfo = (status) => {
    switch(status) {
      case 0: return { label: 'Not Started', color: 'text-yellow-400', bg: 'bg-yellow-400/20', icon: Clock };
      case 1: return { label: 'Ongoing', color: 'text-green-400', bg: 'bg-green-400/20', icon: Vote };
      case 2: return { label: 'Ended', color: 'text-red-400', bg: 'bg-red-400/20', icon: Award };
      default: return { label: 'Unknown', color: 'text-gray-400', bg: 'bg-gray-400/20', icon: AlertCircle };
    }
  };

  // Time formatting
  const formatTimeRemaining = (endTime) => {
    const now = Date.now();
    const diff = endTime - now;
    
    if (diff <= 0) return 'Ended';
    
    const days = Math.floor(diff / (24 * 60 * 60 * 1000));
    const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    
    if (days > 0) return `${days} day${days > 1 ? 's' : ''}`;
    return `${hours} hour${hours > 1 ? 's' : ''}`;
  };

  useEffect(() => {
    // Auto-connect if previously connected
    if (typeof window.ethereum !== 'undefined') {
      window.ethereum.request({ method: 'eth_accounts' })
        .then(accounts => {
          if (accounts.length > 0) {
            connectWallet();
          }
        });
    }
  }, []);

    return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
      {/* Navigation */}
      <nav className="bg-slate-900/90 backdrop-blur-lg border-b border-slate-700/50 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-8">
              <div className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                🗳️ BlockVote
              </div>
              <div className="hidden md:flex space-x-6">
                <button
                  onClick={() => setActiveTab('dashboard')}
                  className={`px-4 py-2 rounded-lg transition-all duration-200 ${
                    activeTab === 'dashboard' 
                      ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' 
                      : 'text-slate-400 hover:text-blue-400 hover:bg-slate-800/50'
                  }`}
                >
                  Dashboard
                </button>
                <button
                  onClick={() => setActiveTab('create')}
                  className={`px-4 py-2 rounded-lg transition-all duration-200 ${
                    activeTab === 'create' 
                      ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' 
                      : 'text-slate-400 hover:text-blue-400 hover:bg-slate-800/50'
                  }`}
                >
                  Create Election
                </button>
                <button
                  onClick={() => setActiveTab('manage')}
                  className={`px-4 py-2 rounded-lg transition-all duration-200 ${
                    activeTab === 'manage' 
                      ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' 
                      : 'text-slate-400 hover:text-blue-400 hover:bg-slate-800/50'
                  }`}
                >
                  Manage
                </button>
              </div>
            </div>
            
            <div className="flex items-center space-x-4">
              {account ? (
                <div className="flex items-center space-x-3 bg-slate-800/50 px-4 py-2 rounded-lg border border-slate-700/50">
                  <Wallet className="w-4 h-4 text-green-400" />
                  <span className="text-sm font-mono text-slate-300">
                    {account.slice(0, 6)}...{account.slice(-4)}
                  </span>
                  <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                </div>
              ) : (
                <button
                  onClick={connectWallet}
                  className="bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white px-6 py-2 rounded-lg font-semibold transition-all duration-200 flex items-center space-x-2"
                >
                  <Wallet className="w-4 h-4" />
                  <span>Connect Wallet</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Dashboard Tab */}
        {activeTab === 'dashboard' && (
          <div className="space-y-8">
            {/* Header */}
            <div className="text-center space-y-4">
              <h1 className="text-5xl font-bold bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
                Blockchain Election System
              </h1>
              <p className="text-xl text-slate-400 max-w-3xl mx-auto">
                Create, manage, and participate in transparent, secure, and decentralized elections powered by smart contracts
              </p>
            </div>

            {/* Search and Filter */}
            <div className="bg-slate-800/50 backdrop-blur-lg rounded-2xl border border-slate-700/50 p-6">
              <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1 relative">
                  <Search className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search elections by title or description..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-slate-900/50 border border-slate-600/50 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50"
                  />
                </div>
                <div className="relative">
                  <Filter className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="pl-10 pr-8 py-3 bg-slate-900/50 border border-slate-600/50 rounded-lg text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50"
                  >
                    <option value="">All Status</option>
                    <option value="ongoing">Ongoing</option>
                    <option value="ended">Ended</option>
                    <option value="not-started">Not Started</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Elections Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {filteredElections.map((election) => {
                const statusInfo = getStatusInfo(election.status);
                const StatusIcon = statusInfo.icon;
                const hasVoted = hasUserVoted(election.id);
                const votedCandidate = getUserVotedCandidate(election.id);
                
                return (
                  <div
                    key={election.id}
                    className="bg-slate-800/50 backdrop-blur-lg rounded-2xl border border-slate-700/50 p-6 hover:border-blue-500/50 transition-all duration-300 hover:transform hover:scale-105"
                  >
                    <div className="space-y-4">
                      {/* Status Badge */}
                      <div className={`inline-flex items-center space-x-2 px-3 py-1 rounded-full text-sm font-semibold ${statusInfo.bg} ${statusInfo.color}`}>
                        <StatusIcon className="w-4 h-4" />
                        <span>{statusInfo.label}</span>
                      </div>
                      
                      {/* Title and Description */}
                      <div>
                        <h3 className="text-xl font-bold text-slate-200 mb-2">{election.title}</h3>
                        <p className="text-slate-400 text-sm line-clamp-2">{election.description}</p>
                      </div>
                      
                      {/* Voting Status */}
                      {hasVoted && (
                        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3">
                          <div className="flex items-center space-x-2 text-green-400 text-sm">
                            <CheckCircle className="w-4 h-4" />
                            <span>Your vote has been recorded.</span>
                          </div>
                        </div>
                      )}
                      
                      {/* Stats */}
                      <div className="grid grid-cols-2 gap-4">
                        <div className="text-center">
                          <div className="text-2xl font-bold text-blue-400">{election.candidates}</div>
                          <div className="text-xs text-slate-500">Candidates</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-green-400">{election.totalVotes}</div>
                          <div className="text-xs text-slate-500">Total Votes</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-purple-400">{election.participation}%</div>
                          <div className="text-xs text-slate-500">Participation</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-yellow-400">{formatTimeRemaining(election.endTime)}</div>
                          <div className="text-xs text-slate-500">{election.status === 1 ? 'Remaining' : election.status === 0 ? 'Starts' : 'Ended'}</div>
                        </div>
                      </div>
                      
                      {/* Actions */}
                      <div className="flex space-x-2">
                        <button
                          onClick={() => viewElectionDetails(election)}
                          className="flex-1 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 px-4 py-2 rounded-lg font-semibold transition-all duration-200 flex items-center justify-center space-x-2"
                        >
                          <Eye className="w-4 h-4" />
                          <span>View</span>
                        </button>
                        {election.status === 1 && !hasVoted && account && (
                          <button
                            onClick={() => viewElectionDetails(election)}
                            disabled={loading}
                            className="flex-1 bg-green-500/20 hover:bg-green-500/30 text-green-400 px-4 py-2 rounded-lg font-semibold transition-all duration-200 flex items-center justify-center space-x-2"
                          >
                            <Vote className="w-4 h-4" />
                            <span>Vote</span>
                          </button>
                        )}
                        {hasVoted && (
                          <button
                            className="flex-1 bg-gray-500/20 text-gray-400 px-4 py-2 rounded-lg font-semibold cursor-not-allowed flex items-center justify-center space-x-2"
                            disabled
                          >
                            <CheckCircle className="w-4 h-4" />
                            <span>Voted</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {filteredElections.length === 0 && (
              <div className="text-center py-12">
                <Vote className="w-16 h-16 text-slate-600 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-slate-400 mb-2">No elections found</h3>
                <p className="text-slate-500">Try adjusting your search or filter criteria</p>
              </div>
            )}
          </div>
        )}

        {/* Create Election Tab */}
        {activeTab === 'create' && (
          <div className="max-w-4xl mx-auto">
            <div className="bg-slate-800/50 backdrop-blur-lg rounded-2xl border border-slate-700/50 p-8">
              <div className="text-center mb-8">
                <h2 className="text-3xl font-bold text-slate-200 mb-2">🗳️ Create New Election</h2>
                <p className="text-slate-400">Set up a new decentralized election with custom parameters</p>
              </div>
              
              <form onSubmit={createElection} className="space-y-8">
                {/* Basic Information */}
                <div className="space-y-6">
                  <h3 className="text-xl font-semibold text-blue-400 flex items-center space-x-2">
                    <Settings className="w-5 h-5" />
                    <span>Basic Information</span>
                  </h3>
                  
                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">Election Title *</label>
                      <input
                        type="text"
                        required
                        value={createElectionForm.title}
                        onChange={(e) => setCreateElectionForm(prev => ({ ...prev, title: e.target.value }))}
                        placeholder="e.g., Student Council Elections 2025"
                        className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600/50 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">Voting Type</label>
                      <select
                        value={createElectionForm.votingType}
                        onChange={(e) => setCreateElectionForm(prev => ({ ...prev, votingType: e.target.value }))}
                        className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600/50 rounded-lg text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50"
                      >
                        <option value="0">Winner Takes All</option>
                        <option value="1">Leaderboard/Ranking</option>
                      </select>
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">Description *</label>
                    <textarea
                      required
                      value={createElectionForm.description}
                      onChange={(e) => setCreateElectionForm(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="Describe the purpose and scope of this election..."
                      rows={4}
                      className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600/50 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 resize-none"
                    />
                  </div>
                </div>

                {/* Timeline */}
                <div className="space-y-6">
                  <h3 className="text-xl font-semibold text-purple-400 flex items-center space-x-2">
                    <Calendar className="w-5 h-5" />
                    <span>Timeline</span>
                  </h3>
                  
                  <div className="grid md:grid-cols-3 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">Candidate Registration Deadline *</label>
                      <input
                        type="datetime-local"
                        required
                        value={createElectionForm.candidateDeadline}
                        onChange={(e) => setCreateElectionForm(prev => ({ ...prev, candidateDeadline: e.target.value }))}
                        className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600/50 rounded-lg text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">Voting Start Time *</label>
                      <input
                        type="datetime-local"
                        required
                        value={createElectionForm.startTime}
                        onChange={(e) => setCreateElectionForm(prev => ({ ...prev, startTime: e.target.value }))}
                        className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600/50 rounded-lg text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">Voting End Time *</label>
                      <input
                        type="datetime-local"
                        required
                        value={createElectionForm.endTime}
                        onChange={(e) => setCreateElectionForm(prev => ({ ...prev, endTime: e.target.value }))}
                        className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600/50 rounded-lg text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50"
                      />
                    </div>
                  </div>
                </div>

                {/* Voter Eligibility */}
                <div className="space-y-6">
                  <h3 className="text-xl font-semibold text-green-400 flex items-center space-x-2">
                    <Users className="w-5 h-5" />
                    <span>Voter Eligibility</span>
                  </h3>
                  
                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">Eligibility Mode</label>
                      <select
                        value={createElectionForm.eligibilityMode}
                        onChange={(e) => setCreateElectionForm(prev => ({ ...prev, eligibilityMode: e.target.value }))}
                        className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600/50 rounded-lg text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50"
                      >
                        <option value="0">Whitelist (Owner selects voters)</option>
                        <option value="1">Open Registration</option>
                        <option value="2">Token-based (Min. balance required)</option>
                        <option value="3">NFT-based (Must own specific NFT)</option>
                      </select>
                    </div>
                    
                    {createElectionForm.eligibilityMode === '2' && (
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">Minimum Token Balance</label>
                        <input
                          type="number"
                          value={createElectionForm.minimumTokenBalance}
                          onChange={(e) => setCreateElectionForm(prev => ({ ...prev, minimumTokenBalance: e.target.value }))}
                          placeholder="100"
                          min="0"
                          className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600/50 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50"
                        />
                      </div>
                    )}
                    
                    {createElectionForm.eligibilityMode === '3' && (
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">Required NFT Contract Address</label>
                        <input
                          type="text"
                          value={createElectionForm.requiredNFTContract}
                          onChange={(e) => setCreateElectionForm(prev => ({ ...prev, requiredNFTContract: e.target.value }))}
                          placeholder="0x..."
                          className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600/50 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50"
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Advanced Settings */}
                <div className="space-y-6">
                  <h3 className="text-xl font-semibold text-yellow-400 flex items-center space-x-2">
                    <Settings className="w-5 h-5" />
                    <span>Advanced Settings</span>
                  </h3>
                  
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <label className="flex items-center space-x-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={createElectionForm.openCandidateRegistration}
                          onChange={(e) => setCreateElectionForm(prev => ({ ...prev, openCandidateRegistration: e.target.checked }))}
                          className="w-4 h-4 text-blue-500 bg-slate-900 border-slate-600 rounded focus:ring-blue-500 focus:ring-2"
                        />
                        <div>
                          <div className="text-slate-300 font-medium">Open Candidate Registration</div>
                          <div className="text-sm text-slate-500">Allow anyone to register as a candidate</div>
                        </div>
                      </label>
                      
                      <label className="flex items-center space-x-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={createElectionForm.liveResultsEnabled}
                          onChange={(e) => setCreateElectionForm(prev => ({ ...prev, liveResultsEnabled: e.target.checked }))}
                          className="w-4 h-4 text-blue-500 bg-slate-900 border-slate-600 rounded focus:ring-blue-500 focus:ring-2"
                        />
                        <div>
                          <div className="text-slate-300 font-medium">Live Results</div>
                          <div className="text-sm text-slate-500">Show results while voting is ongoing</div>
                        </div>
                      </label>
                    </div>
                    
                    <div className="space-y-4">
                      <label className="flex items-center space-x-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={createElectionForm.resultsPublic}
                          onChange={(e) => setCreateElectionForm(prev => ({ ...prev, resultsPublic: e.target.checked }))}
                          className="w-4 h-4 text-blue-500 bg-slate-900 border-slate-600 rounded focus:ring-blue-500 focus:ring-2"
                        />
                        <div>
                          <div className="text-slate-300 font-medium">Public Results</div>
                          <div className="text-sm text-slate-500">Results visible to everyone after election</div>
                        </div>
                      </label>
                      
                      <label className="flex items-center space-x-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={createElectionForm.useCommitReveal}
                          onChange={(e) => setCreateElectionForm(prev => ({ ...prev, useCommitReveal: e.target.checked }))}
                          className="w-4 h-4 text-blue-500 bg-slate-900 border-slate-600 rounded focus:ring-blue-500 focus:ring-2"
                        />
                        <div>
                          <div className="text-slate-300 font-medium">Use Commit-Reveal Voting</div>
                          <div className="text-sm text-slate-500">Enhanced privacy with two-phase voting</div>
                        </div>
                      </label>
                    </div>
                  </div>
                </div>

                {/* Submit Button */}
                <div className="text-center pt-6">
                  <button
                    type="submit"
                    disabled={loading || !account}
                    className="bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 disabled:from-slate-600 disabled:to-slate-600 text-white px-8 py-3 rounded-lg font-semibold transition-all duration-200 flex items-center justify-center space-x-2 mx-auto"
                  >
                    <Plus className="w-5 h-5" />
                    <span>{loading ? 'Creating...' : 'Create Election'}</span>
                  </button>
                  {!account && (
                    <p className="text-sm text-slate-500 mt-2">Please connect your wallet to create an election</p>
                  )}
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Manage Elections Tab */}
        {activeTab === 'manage' && (
          <div className="space-y-8">
            <div className="text-center">
              <h2 className="text-3xl font-bold text-slate-200 mb-2">📊 Election Management</h2>
              <p className="text-slate-400">Manage your elections and view detailed analytics</p>
            </div>

            <div className="bg-slate-800/50 backdrop-blur-lg rounded-2xl border border-slate-700/50 p-8 text-center">
              <Settings className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-slate-400 mb-2">Management Panel Coming Soon</h3>
              <p className="text-slate-500">Advanced election management features will be available here</p>
            </div>
          </div>
        )}
      </div>

      {/* Election Details Modal */}
      {showElectionModal && selectedElection && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-2xl border border-slate-700 max-w-4xl max-h-[90vh] overflow-y-auto w-full">
            <div className="p-6">
              {/* Modal Header */}
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-slate-200 mb-2">{selectedElection.title}</h2>
                  <p className="text-slate-400">{selectedElection.description}</p>
                </div>
                <button
                  onClick={() => setShowElectionModal(false)}
                  className="text-slate-400 hover:text-slate-200 p-2"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {/* Election Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                <div className="text-center p-4 bg-slate-900/50 rounded-lg">
                  <div className="text-2xl font-bold text-blue-400">{selectedElection.candidates}</div>
                  <div className="text-sm text-slate-500">Candidates</div>
                </div>
                <div className="text-center p-4 bg-slate-900/50 rounded-lg">
                  <div className="text-2xl font-bold text-green-400">{selectedElection.totalVotes}</div>
                  <div className="text-sm text-slate-500">Total Votes</div>
                </div>
                <div className="text-center p-4 bg-slate-900/50 rounded-lg">
                  <div className="text-2xl font-bold text-purple-400">{selectedElection.participation}%</div>
                  <div className="text-sm text-slate-500">Participation</div>
                </div>
                <div className="text-center p-4 bg-slate-900/50 rounded-lg">
                  <div className="text-2xl font-bold text-yellow-400">{formatTimeRemaining(selectedElection.endTime)}</div>
                  <div className="text-sm text-slate-500">Time Left</div>
                </div>
              </div>

              {/* Voting Status Check */}
              {hasUserVoted(selectedElection.id) && (
                <div className="mb-6 p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <CheckCircle className="w-5 h-5 text-green-400" />
                      <div>
                        <div className="text-green-400 font-medium">You have already voted!</div>
                        <div className="text-sm text-slate-400">
                          Your vote is hidden for privacy.
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        const candidate = getUserVotedCandidate(selectedElection.id);
                        if (candidate) {
                          setSelectedCandidate(candidate);
                          setShowVotedCandidateModal(true);
                        }
                      }}
                      className="bg-green-500/20 hover:bg-green-500/30 text-green-400 px-4 py-2 rounded-lg font-medium transition-all duration-200"
                    >
                      See Who You Voted For
                    </button>
                  </div>
                </div>
              )}

              {/* Candidates List */}
              <div className="space-y-4">
                <h3 className="text-xl font-semibold text-slate-200 flex items-center space-x-2">
                  <Users className="w-5 h-5" />
                  <span>
                    {selectedElection.status === 2 
                      ? `Results (${getCandidatesForElection(selectedElection.id).length} candidates)` 
                      : `Candidates (${getCandidatesForElection(selectedElection.id).length})`
                    }
                  </span>
                </h3>
                
                {/* Winner Takes All Results */}
                {selectedElection.status === 2 && selectedElection.votingType === 0 && (
                  <div className="mb-6">
                    {(() => {
                      const candidates = getCandidatesForElection(selectedElection.id);
                      const sortedCandidates = [...candidates].sort((a, b) => b.votes - a.votes);
                      const winner = sortedCandidates[0];
                      const totalVotes = candidates.reduce((sum, c) => sum + c.votes, 0);
                      
                      return (
                        <>
                          {/* Winner Banner */}
                          <div className="bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border-2 border-yellow-500/50 rounded-xl p-6 mb-6">
                            <div className="flex items-center justify-center space-x-3 mb-4">
                              <Award className="w-8 h-8 text-yellow-400" />
                              <h4 className="text-2xl font-bold text-yellow-400">🏆 WINNER</h4>
                              <Award className="w-8 h-8 text-yellow-400" />
                            </div>
                            <div className="text-center">
                              <div className="w-20 h-20 bg-gradient-to-br from-yellow-400 to-orange-400 rounded-full flex items-center justify-center text-3xl mx-auto mb-4">
                                {winner.avatar}
                              </div>
                              <h5 className="text-2xl font-bold text-white mb-2">{winner.name}</h5>
                              <p className="text-slate-300 mb-4">{winner.description}</p>
                              <div className="flex items-center justify-center space-x-6">
                                <div className="text-center">
                                  <div className="text-3xl font-bold text-yellow-400">{winner.votes}</div>
                                  <div className="text-sm text-slate-400">votes</div>
                                </div>
                                <div className="text-center">
                                  <div className="text-3xl font-bold text-yellow-400">
                                    {Math.round((winner.votes / totalVotes) * 100)}%
                                  </div>
                                  <div className="text-sm text-slate-400">of total</div>
                                </div>
                              </div>
                            </div>
                          </div>
                          
                          {/* Other Candidates */}
                          <h4 className="text-lg font-semibold text-slate-300 mb-4">Other Candidates</h4>
                          <div className="grid gap-4">
                            {sortedCandidates.slice(1).map((candidate, index) => (
                              <div
                                key={candidate.id}
                                className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4"
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center space-x-4">
                                    <div className="flex items-center space-x-2">
                                      <span className="text-2xl font-bold text-slate-500">#{index + 2}</span>
                                      <div className="w-12 h-12 bg-gradient-to-br from-slate-600 to-slate-700 rounded-full flex items-center justify-center text-lg">
                                        {candidate.avatar}
                                      </div>
                                    </div>
                                    <div>
                                      <h5 className="text-lg font-bold text-slate-200">{candidate.name}</h5>
                                      <p className="text-slate-400 text-sm">{candidate.description}</p>
                                    </div>
                                  </div>
                                  <div className="text-right">
                                    <div className="text-xl font-bold text-slate-300">{candidate.votes}</div>
                                    <div className="text-sm text-slate-500">
                                      {Math.round((candidate.votes / totalVotes) * 100)}%
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}

                {/* Leaderboard Results */}
                {selectedElection.status === 2 && selectedElection.votingType === 1 && (
                  <div className="mb-6">
                    {(() => {
                      const candidates = getCandidatesForElection(selectedElection.id);
                      const sortedCandidates = [...candidates].sort((a, b) => b.votes - a.votes);
                      const totalVotes = candidates.reduce((sum, c) => sum + c.votes, 0);
                      
                      return (
                        <>
                          <div className="bg-gradient-to-r from-purple-500/20 to-blue-500/20 border border-purple-500/50 rounded-xl p-4 mb-6">
                            <div className="flex items-center justify-center space-x-2">
                              <BarChart3 className="w-6 h-6 text-purple-400" />
                              <h4 className="text-xl font-bold text-purple-400">📊 LEADERBOARD RESULTS</h4>
                            </div>
                          </div>
                          
                          <div className="space-y-3">
                            {sortedCandidates.map((candidate, index) => {
                              const percentage = Math.round((candidate.votes / totalVotes) * 100);
                              const getRankColor = (rank) => {
                                if (rank === 0) return 'from-yellow-400 to-orange-400';
                                if (rank === 1) return 'from-gray-400 to-gray-500';  
                                if (rank === 2) return 'from-amber-600 to-amber-700';
                                return 'from-blue-500 to-blue-600';
                              };
                              const getRankIcon = (rank) => {
                                if (rank === 0) return '🥇';
                                if (rank === 1) return '🥈';
                                if (rank === 2) return '🥉';
                                return '🏅';
                              };
                              
                              return (
                                <div
                                  key={candidate.id}
                                  className={`border rounded-lg p-4 ${
                                    index === 0 
                                      ? 'bg-yellow-500/10 border-yellow-500/50' 
                                      : index === 1 
                                      ? 'bg-gray-500/10 border-gray-500/50'
                                      : index === 2
                                      ? 'bg-amber-600/10 border-amber-600/50'
                                      : 'bg-slate-900/50 border-slate-700/50'
                                  }`}
                                >
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center space-x-4">
                                      <div className="flex items-center space-x-2">
                                        <span className="text-2xl">{getRankIcon(index)}</span>
                                        <span className="text-2xl font-bold text-slate-400">#{index + 1}</span>
                                        <div className={`w-14 h-14 bg-gradient-to-br ${getRankColor(index)} rounded-full flex items-center justify-center text-xl`}>
                                          {candidate.avatar}
                                        </div>
                                      </div>
                                      <div>
                                        <h5 className="text-lg font-bold text-slate-200">{candidate.name}</h5>
                                        <p className="text-slate-400 text-sm">{candidate.description}</p>
                                        
                                        {/* Vote Progress Bar */}
                                        <div className="mt-2 w-64">
                                          <div className="flex justify-between text-xs text-slate-500 mb-1">
                                            <span>{candidate.votes} votes</span>
                                            <span>{percentage}%</span>
                                          </div>
                                          <div className="bg-slate-700 rounded-full h-2 overflow-hidden">
                                            <div 
                                              className={`h-full bg-gradient-to-r ${getRankColor(index)} transition-all duration-500`}
                                              style={{ width: `${percentage}%` }}
                                            />
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                    <div className="text-right">
                                      <div className={`text-2xl font-bold ${
                                        index === 0 ? 'text-yellow-400' : 
                                        index === 1 ? 'text-gray-400' :
                                        index === 2 ? 'text-amber-600' : 'text-slate-300'
                                      }`}>
                                        {candidate.votes}
                                      </div>
                                      <div className="text-lg font-medium text-slate-500">{percentage}%</div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}

                {/* Active Election Candidates (for ongoing/not started elections) */}
                {selectedElection.status !== 2 && (
                  <div className="grid gap-4">
                    {getCandidatesForElection(selectedElection.id).map((candidate) => {
                      const isVotingAllowed = selectedElection.status === 1 && account && !hasUserVoted(selectedElection.id);
                      
                      return (
                        <div
                          key={candidate.id}
                          className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-6 hover:border-slate-600/50 transition-all duration-200"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-4">
                              <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-500 rounded-full flex items-center justify-center text-2xl">
                                {candidate.avatar}
                              </div>
                              <div className="flex-1">
                                <h4 className="text-lg font-bold text-slate-200 mb-1">{candidate.name}</h4>
                                <p className="text-slate-400 text-sm mb-2">{candidate.description}</p>
                                {(selectedElection.liveResults || selectedElection.status === 2) && (
                                  <div className="flex items-center space-x-2">
                                    <TrendingUp className="w-4 h-4 text-blue-400" />
                                    <span className="text-blue-400 font-medium">{candidate.votes} votes</span>
                                  </div>
                                )}
                              </div>
                            </div>
                            
                            <div className="flex flex-col items-end space-y-2">
                              {isVotingAllowed ? (
                                <button
                                  onClick={() => initiateVote(candidate, selectedElection)}
                                  className="bg-green-500/20 hover:bg-green-500/30 text-green-400 px-6 py-2 rounded-lg font-semibold transition-all duration-200 flex items-center space-x-2"
                                >
                                  <Vote className="w-4 h-4" />
                                  <span>Vote</span>
                                </button>
                              ) : (
                                <div className="text-slate-500 text-sm">
                                  {selectedElection.status !== 1 ? 'Voting closed' : 
                                   !account ? 'Connect wallet' : 
                                   hasUserVoted(selectedElection.id) ? 'Already voted' : 'Cannot vote'}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end space-x-4 mt-8 pt-6 border-t border-slate-700/50">
                <button
                  onClick={() => setShowElectionModal(false)}
                  className="px-6 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg font-medium transition-all duration-200"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Voted Candidate Details Modal */}
      {showVotedCandidateModal && selectedCandidate && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-2xl border border-slate-700 max-w-md w-full p-6">
            <div className="text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-500 rounded-full flex items-center justify-center text-2xl mx-auto mb-4">
                {selectedCandidate.avatar}
              </div>
              
              <h3 className="text-xl font-bold text-slate-200 mb-2">Your Vote</h3>
              <p className="text-slate-400 mb-6">
                You voted for <strong className="text-green-400">{selectedCandidate.name}</strong>
              </p>
              
              <div className="bg-slate-900/50 rounded-lg p-4 mb-6">
                <p className="text-sm text-slate-300">{selectedCandidate.description}</p>
              </div>
              
              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 mb-6">
                <div className="flex items-center space-x-2 text-green-400">
                  <CheckCircle className="w-4 h-4" />
                  <span className="text-sm font-medium">Vote Confirmed</span>
                </div>
                <p className="text-sm text-slate-400 mt-1">
                  Your vote has been recorded on the blockchain and cannot be changed.
                </p>
              </div>
              
              <button
                onClick={() => setShowVotedCandidateModal(false)}
                className="w-full px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg font-medium transition-all duration-200"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Vote Confirmation Modal */}
      {showVoteConfirmModal && selectedCandidate && selectedElection && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-2xl border border-slate-700 max-w-md w-full p-6">
            <div className="text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-500 rounded-full flex items-center justify-center text-2xl mx-auto mb-4">
                {selectedCandidate.avatar}
              </div>
              
              <h3 className="text-xl font-bold text-slate-200 mb-2">Confirm Your Vote</h3>
              <p className="text-slate-400 mb-6">
                Are you sure you want to vote for <strong className="text-blue-400">{selectedCandidate.name}</strong>?
              </p>
              
              <div className="bg-slate-900/50 rounded-lg p-4 mb-6">
                <p className="text-sm text-slate-300">{selectedCandidate.description}</p>
              </div>
              
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4 mb-6">
                <div className="flex items-center space-x-2 text-yellow-400">
                  <AlertCircle className="w-4 h-4" />
                  <span className="text-sm font-medium">Important</span>
                </div>
                <p className="text-sm text-slate-400 mt-1">
                  This action cannot be undone. Your vote will be recorded on the blockchain.
                </p>
              </div>
              
              <div className="flex space-x-4">
                <button
                  onClick={() => setShowVoteConfirmModal(false)}
                  className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg font-medium transition-all duration-200"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmVote}
                  disabled={loading}
                  className="flex-1 px-4 py-2 bg-green-500 hover:bg-green-600 disabled:bg-green-600/50 text-white rounded-lg font-medium transition-all duration-200 flex items-center justify-center space-x-2"
                >
                  <Vote className="w-4 h-4" />
                  <span>{loading ? 'Voting...' : 'Yes, Vote'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Loading Overlay */}
      {loading && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg p-6 flex items-center space-x-4">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-400"></div>
            <span className="text-slate-200">Processing transaction...</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default ElectionDApp;