const { merge } = require('webpack-merge');
const common = require('./webpack.common.js');

module.exports = common({ onlyTranspileTypescript: true }).map((config) =>
  merge(config, {
    mode: 'development',
    devtool: 'inline-cheap-source-map',
  })
);
