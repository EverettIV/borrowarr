const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const ActivityLog = sequelize.define(
  'ActivityLog',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    userId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    /** Feature area, e.g. file_rename, download_watcher */
    category: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    /** Specific event within category, e.g. movie_rename_success */
    action: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM('success', 'failure', 'info'),
      allowNull: false,
      defaultValue: 'info',
    },
    summary: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    /** JSON object — paths, ids, errors, etc. */
    details: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    tableName: 'ActivityLogs',
    indexes: [
      { fields: ['userId'] },
      { fields: ['userId', 'category'] },
      { fields: ['createdAt'] },
    ],
  },
);

module.exports = ActivityLog;