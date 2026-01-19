import { useRef, useState, useEffect, useCallback } from 'react'
import type { AutoWorkOptions, AutoWorkState } from './types.js'

interface UseAutoWorkOptions {
  ptyId: string
  sendBackendCommand: (commandId: string) => boolean
  triggerSummarize: () => void
}

interface UseAutoWorkReturn {
  autoWorkState: AutoWorkState
  awaitingUserReview: boolean
  pendingAutoWorkContinue: boolean
  buildAutoWorkPrompt: () => string
  handleAutoWorkMarker: (cleanChunk: string) => void
  startAutoWork: (options?: AutoWorkOptions) => void
  continueAutoWork: () => void
  stopAutoWork: () => void
  cancelAutoWork: () => void
  setPendingAutoWorkContinue: React.Dispatch<React.SetStateAction<boolean>>
  setAwaitingUserReview: React.Dispatch<React.SetStateAction<boolean>>
}

/**
 * Hook for managing the auto work loop feature.
 * Handles detection of continuation markers and coordinating with summary capture.
 */
export function useAutoWork({
  ptyId,
  sendBackendCommand,
  triggerSummarize,
}: UseAutoWorkOptions): UseAutoWorkReturn {
  // Auto work mode refs
  const autoWorkModeRef = useRef(false)
  const autoWorkWithSummaryRef = useRef(false)
  const autoWorkAskQuestionsRef = useRef(false)
  const autoWorkPauseForReviewRef = useRef(false)
  const autoWorkFinalEvaluationRef = useRef(false)
  const autoWorkGitCommitRef = useRef(false)

  // State for UI feedback
  const [pendingAutoWorkContinue, setPendingAutoWorkContinue] = useState(false)
  const [awaitingUserReview, setAwaitingUserReview] = useState(false)

  // Build current state object
  const autoWorkState: AutoWorkState = {
    enabled: autoWorkModeRef.current,
    withSummary: autoWorkWithSummaryRef.current,
    askQuestions: autoWorkAskQuestionsRef.current,
    pauseForReview: autoWorkPauseForReviewRef.current,
    finalEvaluation: autoWorkFinalEvaluationRef.current,
    gitCommit: autoWorkGitCommitRef.current,
  }

  // Build the autowork prompt based on current options
  const buildAutoWorkPrompt = useCallback(() => {
    let noTasksAction = 'commit all changes to git with a summary message and push to remote, then say "All beads tasks complete!" and stop'
    if (autoWorkFinalEvaluationRef.current) {
      noTasksAction = 'commit all changes to git with a summary message and push to remote. Then run "bd list --status=closed" to see all completed tasks from this session. For each completed task, provide: 1) A brief summary of what was implemented, 2) How to test it (specific steps), 3) What to look for to verify it works. Include any potential bugs, edge cases, or issues discovered during implementation. End with a checklist the user can follow to evaluate all the work.'
    }

    let prompt = `Run bd ready to check for tasks. If no tasks are available, ${noTasksAction} Otherwise, analyze ALL available tasks and determine which one should be worked on first - consider: 1) Is this task a prerequisite for other tasks? 2) Does it provide foundation/infrastructure needed by others? 3) Is it simpler and unblocks more complex work? Pick the ONE task that makes the most sense to do first. IMPORTANT: If while working you discover missing prerequisites, dependencies, or required functionality that doesn't exist yet, use "bd create" to add new tasks for them. Complete the task fully, close it with bd close <id>`

    if (autoWorkAskQuestionsRef.current) {
      prompt = `Run bd ready to check for tasks. If no tasks are available, ${noTasksAction} Otherwise, analyze ALL available tasks and determine which one should be worked on first - consider dependencies and logical order. Before starting the chosen task, ask any clarifying questions you have about the requirements. Work on the task, asking questions as needed. IMPORTANT: If you discover missing prerequisites or required functionality, use "bd create" to add new tasks for them. When complete, close it with bd close <id>`
    }

    if (autoWorkGitCommitRef.current) {
      prompt += '. After closing the task, commit the changes to git with a descriptive message mentioning the task ID (e.g., "Implement feature X [beads-abc]") and push to remote'
    }

    if (autoWorkPauseForReviewRef.current) {
      prompt += ', then say "Task complete. Review the changes and provide feedback, or use Continue to Next Task to proceed."'
    }

    prompt += ' Then output the marker: three equals signs, AUTOWORK_CONTINUE, three equals signs.'
    return prompt
  }, [])

  // Handle auto work continuation marker detection
  const handleAutoWorkMarker = useCallback((cleanChunk: string) => {
    if (!autoWorkModeRef.current) return
    if (!cleanChunk.includes('===AUTOWORK_CONTINUE===')) return

    if (autoWorkPauseForReviewRef.current) {
      setAwaitingUserReview(true)
    } else if (autoWorkWithSummaryRef.current) {
      triggerSummarize()
    } else {
      setPendingAutoWorkContinue(true)
    }
  }, [triggerSummarize])

  // Handle pending auto work continuation
  useEffect(() => {
    if (!pendingAutoWorkContinue) return

    console.log('[AutoWork] Continuation triggered, running /clear')
    const didClear = sendBackendCommand('clear')
    const clearDelay = didClear ? 2000 : 100

    setTimeout(() => {
      console.log('[AutoWork] Sending continuation prompt')
      const continuePrompt = buildAutoWorkPrompt()
      window.electronAPI.writePty(ptyId, continuePrompt + '\r')
    }, clearDelay)

    setPendingAutoWorkContinue(false)
  }, [pendingAutoWorkContinue, ptyId, sendBackendCommand, buildAutoWorkPrompt])

  // Start auto work mode
  const startAutoWork = useCallback((options?: AutoWorkOptions) => {
    autoWorkModeRef.current = true
    autoWorkWithSummaryRef.current = options?.withContext ?? false
    autoWorkAskQuestionsRef.current = options?.askQuestions ?? false
    autoWorkPauseForReviewRef.current = options?.pauseForReview ?? false
    autoWorkFinalEvaluationRef.current = options?.finalEvaluation ?? false
    autoWorkGitCommitRef.current = options?.gitCommitEachTask ?? false
    setAwaitingUserReview(false)
    console.log('[AutoWork] Mode enabled with options:', options)

    const didClear = sendBackendCommand('clear')
    const clearDelay = didClear ? 2000 : 100
    setTimeout(() => {
      console.log('[AutoWork] Sending initial prompt')
      window.electronAPI.writePty(ptyId, buildAutoWorkPrompt() + '\r')
    }, clearDelay)
  }, [ptyId, sendBackendCommand, buildAutoWorkPrompt])

  // Continue to next task
  const continueAutoWork = useCallback(() => {
    console.log('[AutoWork] Continue to next task requested, awaitingReview:', awaitingUserReview, 'autoWorkMode:', autoWorkModeRef.current)
    setAwaitingUserReview(false)

    if (autoWorkModeRef.current) {
      if (autoWorkWithSummaryRef.current) {
        triggerSummarize()
      } else {
        setPendingAutoWorkContinue(true)
      }
    } else {
      console.log('[AutoWork] Not in autowork mode, starting fresh')
      autoWorkModeRef.current = true
      const didClear = sendBackendCommand('clear')
      const clearDelay = didClear ? 2000 : 100
      setTimeout(() => {
        window.electronAPI.writePty(ptyId, buildAutoWorkPrompt() + '\r')
      }, clearDelay)
    }
  }, [awaitingUserReview, ptyId, sendBackendCommand, buildAutoWorkPrompt, triggerSummarize])

  // Stop auto work gracefully
  const stopAutoWork = useCallback(() => {
    autoWorkModeRef.current = false
    autoWorkWithSummaryRef.current = false
    autoWorkAskQuestionsRef.current = false
    autoWorkPauseForReviewRef.current = false
    autoWorkFinalEvaluationRef.current = false
    autoWorkGitCommitRef.current = false
    setAwaitingUserReview(false)
    console.log('[AutoWork] Mode disabled - will stop after current task')
    window.electronAPI.writePty(ptyId, 'When you finish the current task, do NOT output the AUTOWORK_CONTINUE marker. Just complete this task and wait for further input.\r')
  }, [ptyId])

  // Cancel auto work immediately
  const cancelAutoWork = useCallback(() => {
    autoWorkModeRef.current = false
    autoWorkWithSummaryRef.current = false
    autoWorkAskQuestionsRef.current = false
    autoWorkPauseForReviewRef.current = false
    autoWorkFinalEvaluationRef.current = false
    autoWorkGitCommitRef.current = false
    setAwaitingUserReview(false)
    console.log('[AutoWork] Mode disabled by cancel')
    window.electronAPI.writePty(ptyId, '\x1b')
  }, [ptyId])

  return {
    autoWorkState,
    awaitingUserReview,
    pendingAutoWorkContinue,
    buildAutoWorkPrompt,
    handleAutoWorkMarker,
    startAutoWork,
    continueAutoWork,
    stopAutoWork,
    cancelAutoWork,
    setPendingAutoWorkContinue,
    setAwaitingUserReview,
  }
}
