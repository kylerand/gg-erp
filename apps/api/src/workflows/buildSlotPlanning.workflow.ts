export const buildSlotPlanningWorkflowDefinition = {
  Comment: 'Build slot planning workflow placeholder',
  StartAt: 'GatherInputs',
  States: {
    GatherInputs: {
      Type: 'Task',
      Next: 'ScoreCandidates'
    },
    ScoreCandidates: {
      Type: 'Task',
      Next: 'PublishPlan'
    },
    PublishPlan: {
      Type: 'Task',
      End: true
    }
  }
} as const;
