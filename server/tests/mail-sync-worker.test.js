import mongoose from 'mongoose'
import { expect, it, vi } from 'vitest'
import GmailSyncJob from '../src/models/gmail-sync-job.model.js'
import { holdBatchLease } from '../src/services/mail-sync-worker.service.js'

async function job(status) {
  const created = await GmailSyncJob.create({ userId: new mongoose.Types.ObjectId(), connectionId: new mongoose.Types.ObjectId(), status })
  const stale = new Date(Date.now() - 10 * 60 * 1000)
  await GmailSyncJob.collection.updateOne({ _id: created._id }, { $set: { updatedAt: stale } })
  return { id: created._id, stale }
}

it('keeps a running metadata batch lease fresh so another worker cannot reclaim it', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  try {
    const running = await job('SCANNING')
    const finished = await job('COMPLETED')
    const stopRunning = holdBatchLease(GmailSyncJob, running.id)
    const stopFinished = holdBatchLease(GmailSyncJob, finished.id)
    await vi.advanceTimersByTimeAsync(60000)
    await vi.waitFor(async () => expect((await GmailSyncJob.findById(running.id).lean()).updatedAt.getTime()).toBeGreaterThan(running.stale.getTime()))
    // A finished job is never touched, so its timestamps stay meaningful.
    expect((await GmailSyncJob.findById(finished.id).lean()).updatedAt.getTime()).toBe(finished.stale.getTime())
    stopRunning(); stopFinished()
    await GmailSyncJob.collection.updateOne({ _id: running.id }, { $set: { updatedAt: running.stale } })
    await vi.advanceTimersByTimeAsync(120000)
    expect((await GmailSyncJob.findById(running.id).lean()).updatedAt.getTime()).toBe(running.stale.getTime())
  } finally { vi.useRealTimers() }
})

it('stops renewing a batch that never finishes so a hung process cannot hold the job forever', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  try {
    const running = await job('SCANNING')
    const stop = holdBatchLease(GmailSyncJob, running.id, 60000, 120000)
    await vi.advanceTimersByTimeAsync(120000)
    await vi.waitFor(async () => expect((await GmailSyncJob.findById(running.id).lean()).updatedAt.getTime()).toBeGreaterThan(running.stale.getTime()))
    await GmailSyncJob.collection.updateOne({ _id: running.id }, { $set: { updatedAt: running.stale } })
    await vi.advanceTimersByTimeAsync(300000)
    expect((await GmailSyncJob.findById(running.id).lean()).updatedAt.getTime()).toBe(running.stale.getTime())
    stop()
  } finally { vi.useRealTimers() }
})
