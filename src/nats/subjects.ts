/**
 * Canonical NATS subject constants — single source of truth.
 *
 * Convention: subject = `<consumerDomain>.<EVENT_SCREAMING_SNAKE>`
 * The domain prefix equals the service that SUBSCRIBES to the event.
 *
 * One JetStream stream per consumer domain:
 *   LEARN     → filter `learn.>`
 *   CONTENT   → filter `content.>`
 *   CREDENTIAL → filter `credential.>`
 *   ASSESSMENT → filter `assessment.>`
 *   SKILLMASTER → filter `skillmaster.>` (external service, not in core-5)
 */

// ---------------------------------------------------------------------------
// LEARN stream subjects  (consumer: fs-learn-api)
// ---------------------------------------------------------------------------
export const LEARN = {
  // Events published by fs-content-api → consumed by fs-learn-api
  COURSE_DELETE: 'learn.COURSE_DELETE',
  COURSE_PUBLISH: 'learn.COURSE_PUBLISH',
  COURSES_UPDATE: 'learn.COURSES_UPDATE',
  LEARNINGPATH_PUBLISH: 'learn.LEARNINGPATH_PUBLISH',
  CLEAR_CALENDAR_CACHE_BY_WORKSPACE_ID: 'learn.CLEAR_CALENDAR_CACHE_BY_WORKSPACE_ID',
  // Events published by fs-credential-api → consumed by fs-learn-api
  CREATE_USER_IN_LEARN: 'learn.CREATE_USER_IN_LEARN',
  DELETE_USER: 'learn.DELETE_USER',
  UPDATE_USER_EMAIL_IN_LEARN: 'learn.UPDATE_USER_EMAIL_IN_LEARN',
  UPDATE_WORKSPACE_ID: 'learn.UPDATE_WORKSPACE_ID',
  // Self-loop events (fs-learn-api → fs-learn-api)
  LEARN_API_COURSE_COMPLETED: 'learn.LEARN_API_COURSE_COMPLETED',
  LEARN_API_LESSON_COMPLETED: 'learn.LEARN_API_LESSON_COMPLETED',
  LEARN_API_LEARNING_PATH_CREATED: 'learn.LEARN_API_LEARNING_PATH_CREATED',
  // Events published by fs-assessment → consumed by fs-learn-api
  ADD_ATTEND_ADVANCE_TEST: 'learn.ADD_ATTEND_ADVANCE_TEST',
} as const;

// ---------------------------------------------------------------------------
// CONTENT stream subjects  (consumer: fs-content-api)
// ---------------------------------------------------------------------------
export const CONTENT = {
  // Events published by fs-learn-api → consumed by fs-content-api
  COUNT_USER_ATTEND_COURSE: 'content.COUNT_USER_ATTEND_COURSE',
  COUNT_USER_ATTEND_LEARNING_PATH: 'content.COUNT_USER_ATTEND_LEARNING_PATH',
  // Events published by fs-credential-api → consumed by fs-content-api
  UPSERT_INSTRUCTOR: 'content.UPSERT_INSTRUCTOR',
  // Self-loop events (fs-content-api → fs-content-api)
  BATCH_UPDATE_ASSIGNMENT_CLASS: 'content.BATCH_UPDATE_ASSIGNMENT_CLASS',
  BATCH_CLEAR_CALENDAR_CACHE: 'content.BATCH_CLEAR_CALENDAR_CACHE',
} as const;

// ---------------------------------------------------------------------------
// CREDENTIAL stream subjects  (consumer: fs-credential-api)
// ---------------------------------------------------------------------------
export const CREDENTIAL = {
  // Events published by fs-learn-api, fs-content-api, fs-credential-api(self)
  CREATE_AUDIT_LOG: 'credential.CREATE_AUDIT_LOG',
  SYSTEM_NOTIFICATION_BUSINESS: 'credential.SYSTEM_NOTIFICATION_BUSINESS',
  // Event published by credential self (notification cleanup)
  DELETE_NOTIFICATION_USER: 'credential.DELETE_NOTIFICATION_USER',
  // Event published by fs-content-api → consumed by fs-credential-api
  DELETE_FILES: 'credential.DELETE_FILES',
} as const;

// ---------------------------------------------------------------------------
// ASSESSMENT stream subjects  (consumer: fs-assessment)
// ---------------------------------------------------------------------------
export const ASSESSMENT = {} as const;

// ---------------------------------------------------------------------------
// SKILLMASTER stream subjects  (consumer: external fs-skillmaster — NOT in core-5)
// Orphan producers: align when fs-skillmaster migrates to NATS.
// ---------------------------------------------------------------------------
export const SKILLMASTER = {
  ADD_ASSIGNMENT: 'skillmaster.ADD_ASSIGNMENT',
  UPDATE_ASSIGNMENT: 'skillmaster.UPDATE_ASSIGNMENT',
  ADD_STUDENTS: 'skillmaster.ADD_STUDENTS',
  REMOVE_STUDENTS: 'skillmaster.REMOVE_STUDENTS',
  ADD_DETAILS: 'skillmaster.ADD_DETAILS',
  REMOVE_DETAILS: 'skillmaster.REMOVE_DETAILS',
  REMOVE_ASSIGNMENT: 'skillmaster.REMOVE_ASSIGNMENT',
  ADD_ATTEND: 'skillmaster.ADD_ATTEND',
  SEND_ASSIGNMENT_REPORT: 'skillmaster.SEND_ASSIGNMENT_REPORT',
  CLASS_ADVANCE_NOTIFICATION_DYNAMIC_DAYS: 'skillmaster.CLASS_ADVANCE_NOTIFICATION_DYNAMIC_DAYS',
  COURSE_CREATED_FAILED: 'skillmaster.COURSE_CREATED_FAILED',
} as const;

// ---------------------------------------------------------------------------
// Grouped export
// ---------------------------------------------------------------------------
export const NATS_SUBJECTS = {
  LEARN,
  CONTENT,
  CREDENTIAL,
  ASSESSMENT,
  SKILLMASTER,
} as const;

// ---------------------------------------------------------------------------
// Stream definitions — single source of truth for stream names + subject filters
// ---------------------------------------------------------------------------
export const NATS_STREAMS = {
  LEARN: {
    name: 'LEARN',
    subjects: ['learn.>'],
  },
  CONTENT: {
    name: 'CONTENT',
    subjects: ['content.>'],
  },
  CREDENTIAL: {
    name: 'CREDENTIAL',
    subjects: ['credential.>'],
  },
  ASSESSMENT: {
    name: 'ASSESSMENT',
    subjects: ['assessment.>'],
  },
  SKILLMASTER: {
    name: 'SKILLMASTER',
    subjects: ['skillmaster.>'],
  },
} as const;
