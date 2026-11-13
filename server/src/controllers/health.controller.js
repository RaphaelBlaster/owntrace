import mongoose from 'mongoose'

function getHealth(_request, response) {
  response.status(200).json({
    success: true,
    message: 'OwnTrace API is running',
  })
}

function getReadiness(_request, response) {
  const databaseReady = mongoose.connection.readyState === 1
  response.status(databaseReady ? 200 : 503).json({
    success: databaseReady,
    status: databaseReady ? 'ready' : 'not_ready',
  })
}

export { getHealth, getReadiness }
