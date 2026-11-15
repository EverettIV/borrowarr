const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Settings = sequelize.define('Settings', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'Users',
      key: 'id',
    },
    onDelete: 'CASCADE',
  },
  movieDirectory: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: null,
  },
  seriesDirectory: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: null,
  },
  movieFileFormat: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: '{Movie Title} ({Release Year})',
  },
  seriesFileFormat: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: '{Series Title}/Season {season:00}/{Series Title} - S{season:00}E{episode:00} - {Episode Title}',
  },
  minQuality: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: '720p',
  },
  maxQuality: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: '1080p',
  },
  preferredQuality: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: '720p',
  },
  preferSeedersInQualityRange: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
  autoDownload: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
  allowQualityUpgrade: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
  maxGrabsPerCycle: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 5,
  },
  autoRename: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  autoRenameInterval: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 60, // minutes - how often to scan and rename files
  },
  autoRenameWarningShown: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false, // tracks if user has seen the beta warning
  },
  // Download Watcher Settings
  downloadWatcherEnabled: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  movieWatcherEnabled: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
  seriesWatcherEnabled: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
  movieDownloadDirectory: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: null, // Where movie downloads come from
  },
  seriesDownloadDirectory: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: null, // Where TV downloads come from
  },
  movieWatcherDestination: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: null, // Where movies get moved to
  },
  seriesWatcherDestination: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: null, // Where TV shows get moved to
  },
  watcherInterval: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 30, // seconds - how often to check for new downloads
  },
  watcherAutoApprove: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false, // if false, files require manual approval before moving
  },
  applyNamingOnWatcherApprove: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
  applyNamingOnAutomaticMove: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  movieNamingScanTarget: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'media', // media | download
  },
  movieNamingUseFolders: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false, // false = flat file in scan root; true = one folder per movie
  },
  movieRenameCleanupReleaseFolder: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false, // after rename, delete leftover junk in the old release folder
  },
  seriesNamingScanTarget: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'media',
  },
  movieApplyNamingOnWatcherApprove: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
  seriesApplyNamingOnWatcherApprove: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
  movieApplyNamingOnAutomaticMove: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  seriesApplyNamingOnAutomaticMove: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  movieWatcherDownloadMode: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'saved', // saved | custom
  },
  movieWatcherMediaMode: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'saved',
  },
  movieWatcherCustomDownloadDirectory: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: null,
  },
  movieWatcherCustomMediaDirectory: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: null,
  },
  seriesWatcherDownloadMode: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'saved',
  },
  seriesWatcherMediaMode: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'saved',
  },
  seriesWatcherCustomDownloadDirectory: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: null,
  },
  seriesWatcherCustomMediaDirectory: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: null,
  },
  anomalyDetectorAutoScanEnabled: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  anomalyDetectorScanInterval: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1800,
  },
  anomalyDetectorScanDirKey: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'movieMedia',
  },
  anomalyDetectorCustomScanPath: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: null,
  },
  anomalyDetectorCheckDuplicates: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
  anomalyDetectorCheckCorruption: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  anomalyDetectorCheckLargeFiles: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  checkInterval: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 300, // seconds (default 5 minutes)
  },
  publicRegistrationEnabled: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
  // Completed Download Handling (CDH)
  completedDownloadHandlingEnabled: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  completedDownloadHandlingImportEnabled: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  completedDownloadCheckInterval: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 60,
    comment: 'Seconds between client API polls for tracked downloads',
  },
  completedDownloadImportMode: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'hardlink',
    comment: 'hardlink | copy | move',
  },
  completedDownloadRemoveFromClient: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  remotePathMappings: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: [],
    comment: '[{ host: "/downloads", remote: "/data/downloads" }] Docker path translation',
  },
}, {
  tableName: 'Settings',
  timestamps: true,
});

module.exports = Settings;

