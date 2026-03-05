/**
 * 助手常量定义
 */

// 流程状态
export const PROCESS_STATUS = {
  INITIALIZED: 'initialized',
  PARAMETER_COLLECTION: 'parameter_collection',
  PENDING_CONFIRMATION: 'pending_confirmation',
  EXECUTING: 'executing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

// 意图类型
export const INTENT_TYPE = {
  CREATE_SUBMISSION: 'create_submission',
  QUERY_STATUS: 'query_status',
  CANCEL_SUBMISSION: 'cancel_submission',
  URGE: 'urge',
  SUPPLEMENT: 'supplement',
  DELEGATE: 'delegate',
  SERVICE_REQUEST: 'service_request',
  UNKNOWN: 'unknown',
} as const;

// 字段类型
export const FIELD_TYPE = {
  TEXT: 'text',
  NUMBER: 'number',
  DATE: 'date',
  DATETIME: 'datetime',
  SELECT: 'select',
  RADIO: 'radio',
  CHECKBOX: 'checkbox',
  FILE: 'file',
  TEXTAREA: 'textarea',
  EMAIL: 'email',
  PHONE: 'phone',
  URL: 'url',
} as const;

// 验证类型
export const VALIDATION_TYPE = {
  REQUIRED: 'required',
  MIN_LENGTH: 'min_length',
  MAX_LENGTH: 'max_length',
  MIN_VALUE: 'min_value',
  MAX_VALUE: 'max_value',
  PATTERN: 'pattern',
  EMAIL: 'email',
  PHONE: 'phone',
  DATE_RANGE: 'date_range',
  CUSTOM: 'custom',
} as const;

// 步骤动作
export const STEP_ACTION = {
  VALIDATE: 'validate',
  TRANSFORM: 'transform',
  CALL_MCP: 'call_mcp',
  NOTIFY: 'notify',
  WAIT: 'wait',
  BRANCH: 'branch',
} as const;

// 参数来源
export const PARAMETER_SOURCE = {
  USER_INPUT: 'user_input',
  SHARED_CONTEXT: 'shared_context',
  SYSTEM: 'system',
  COMPUTED: 'computed',
} as const;

// 审计日志动作
export const AUDIT_ACTION = {
  INTENT_DETECTION: 'intent_detection',
  PROCESS_INITIALIZED: 'process_initialized',
  PARAMETER_COLLECTED: 'parameter_collected',
  SUBMIT_APPLICATION: 'submit_application',
  ACTION_CANCEL: 'action_cancel',
  ACTION_URGE: 'action_urge',
  ACTION_SUPPLEMENT: 'action_supplement',
  ACTION_DELEGATE: 'action_delegate',
  QUERY_STATUS: 'query_status',
  SERVICE_REQUEST: 'service_request',
  CHAT_ERROR: 'chat_error',
  CREATE_SUBMISSION_ERROR: 'create_submission_error',
} as const;

// 审计结果
export const AUDIT_RESULT = {
  SUCCESS: 'success',
  DENIED: 'denied',
  ERROR: 'error',
} as const;

// 默认配置
export const DEFAULT_CONFIG = {
  // 会话配置
  SESSION_EXPIRATION_DAYS: 30,
  MAX_CONVERSATION_HISTORY: 50,

  // 参数收集配置
  MAX_COLLECTION_ROUNDS: 20,
  COLLECTION_TIMEOUT_MS: 300000, // 5分钟

  // 重试配置
  MAX_RETRY_ATTEMPTS: 3,
  RETRY_DELAY_MS: 1000,
  RETRY_BACKOFF_MULTIPLIER: 2,

  // MCP配置
  MCP_TIMEOUT_MS: 30000,
  MCP_MAX_RETRIES: 3,

  // 验证配置
  MIN_TEXT_LENGTH: 1,
  MAX_TEXT_LENGTH: 1000,
  MAX_TEXTAREA_LENGTH: 5000,
  MIN_AMOUNT: 0,
  MAX_AMOUNT: 1000000,

  // 语言配置
  DEFAULT_LANGUAGE: 'zh-CN',
  SUPPORTED_LANGUAGES: ['zh-CN', 'en-US'],
} as const;

// 错误代码
export const ERROR_CODE = {
  // 参数错误
  PARAMETER_REQUIRED: 'PARAMETER_REQUIRED',
  PARAMETER_INVALID: 'PARAMETER_INVALID',
  PARAMETER_TYPE_ERROR: 'PARAMETER_TYPE_ERROR',

  // 验证错误
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  MIN_LENGTH_ERROR: 'MIN_LENGTH_ERROR',
  MAX_LENGTH_ERROR: 'MAX_LENGTH_ERROR',
  MIN_VALUE_ERROR: 'MIN_VALUE_ERROR',
  MAX_VALUE_ERROR: 'MAX_VALUE_ERROR',
  PATTERN_ERROR: 'PATTERN_ERROR',
  EMAIL_ERROR: 'EMAIL_ERROR',
  PHONE_ERROR: 'PHONE_ERROR',
  DATE_RANGE_ERROR: 'DATE_RANGE_ERROR',

  // 流程错误
  PROCESS_NOT_FOUND: 'PROCESS_NOT_FOUND',
  PROCESS_ALREADY_EXISTS: 'PROCESS_ALREADY_EXISTS',
  PROCESS_EXECUTION_FAILED: 'PROCESS_EXECUTION_FAILED',
  PROCESS_TIMEOUT: 'PROCESS_TIMEOUT',

  // 会话错误
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  SESSION_INVALID: 'SESSION_INVALID',

  // 用户错误
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  USER_UNAUTHORIZED: 'USER_UNAUTHORIZED',

  // MCP错误
  MCP_CALL_FAILED: 'MCP_CALL_FAILED',
  MCP_TIMEOUT: 'MCP_TIMEOUT',
  MCP_TOOL_NOT_FOUND: 'MCP_TOOL_NOT_FOUND',

  // 系统错误
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
} as const;

// 错误消息
export const ERROR_MESSAGE = {
  [ERROR_CODE.PARAMETER_REQUIRED]: '参数不能为空',
  [ERROR_CODE.PARAMETER_INVALID]: '参数格式不正确',
  [ERROR_CODE.PARAMETER_TYPE_ERROR]: '参数类型错误',
  [ERROR_CODE.VALIDATION_FAILED]: '验证失败',
  [ERROR_CODE.PROCESS_NOT_FOUND]: '流程不存在',
  [ERROR_CODE.PROCESS_EXECUTION_FAILED]: '流程执行失败',
  [ERROR_CODE.SESSION_NOT_FOUND]: '会话不存在',
  [ERROR_CODE.SESSION_EXPIRED]: '会话已过期',
  [ERROR_CODE.USER_NOT_FOUND]: '用户不存在',
  [ERROR_CODE.USER_UNAUTHORIZED]: '用户无权限',
  [ERROR_CODE.MCP_CALL_FAILED]: 'MCP调用失败',
  [ERROR_CODE.MCP_TOOL_NOT_FOUND]: 'MCP工具不存在',
  [ERROR_CODE.INTERNAL_ERROR]: '系统内部错误',
} as const;

// 状态文本映射
export const STATUS_TEXT = {
  pending: '待提交',
  submitted: '已提交',
  approved: '已批准',
  rejected: '已拒绝',
  failed: '提交失败',
  cancelled: '已取消',
  processing: '处理中',
  completed: '已完成',
} as const;

// 操作名称映射
export const ACTION_NAME = {
  cancel: '撤回',
  urge: '催办',
  supplement: '补件',
  delegate: '转办',
  approve: '批准',
  reject: '拒绝',
} as const;

// 流程类别
export const PROCESS_CATEGORY = {
  LEAVE: '请假',
  REIMBURSEMENT: '报销',
  PROCUREMENT: '采购',
  BUSINESS_TRIP: '出差',
  MEETING_ROOM: '会议室',
  EQUIPMENT: '设备',
  OTHER: '其他',
} as const;

// 常用关键词
export const COMMON_KEYWORDS = {
  // 意图关键词
  INTENT: {
    CREATE: ['申请', '发起', '提交', '办理', '我要', '帮我'],
    QUERY: ['查询', '进度', '状态', '到哪了', '怎么样了'],
    CANCEL: ['撤回', '取消', '撤销', '不要了', '作废'],
    URGE: ['催办', '催一下', '加急', '催促'],
    SUPPLEMENT: ['补件', '补充', '补材料', '追加'],
    DELEGATE: ['转办', '转交', '委托', '代办'],
  },

  // 流程类型关键词
  PROCESS: {
    LEAVE: ['请假', '休假', '年假', '病假', '事假'],
    REIMBURSEMENT: ['报销', '差旅', '费用'],
    PROCUREMENT: ['采购', '购买', '物品'],
    BUSINESS_TRIP: ['出差', '外出'],
    MEETING_ROOM: ['会议室', '预约', '会议'],
  },

  // 确认关键词
  CONFIRMATION: {
    YES: ['确认', '提交', '是', '好', 'ok', 'yes', 'y'],
    NO: ['取消', '不', 'no', 'n', '算了'],
    MODIFY: ['修改', '改', '重新填'],
  },

  // 时间关键词
  TIME: {
    TODAY: ['今天', '今日'],
    TOMORROW: ['明天'],
    YESTERDAY: ['昨天'],
    THIS_WEEK: ['本周', '这周'],
    NEXT_WEEK: ['下周'],
    THIS_MONTH: ['本月', '这个月'],
    NEXT_MONTH: ['下月', '下个月'],
  },
} as const;

// 正则表达式
export const REGEX_PATTERNS = {
  // 日期格式
  DATE: /\d{4}[-/]\d{1,2}[-/]\d{1,2}/,
  DATE_TIME: /\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{1,2}/,

  // 金额
  AMOUNT: /(\d+(?:\.\d+)?)\s*(?:元|块|万)/,

  // 联系方式
  EMAIL: /[\w.-]+@[\w.-]+\.\w+/,
  PHONE: /1[3-9]\d{9}/,

  // 编号
  ID: /[A-Z0-9]{10,}/,

  // 数字
  NUMBER: /\d+(?:\.\d+)?/,

  // 中文
  CHINESE: /[\u4e00-\u9fa5]/,

  // 英文
  ENGLISH: /[a-zA-Z]/,
} as const;

// 提示语模板
export const PROMPT_TEMPLATES = {
  // 参数收集
  COLLECT_PARAMETER: '请问{label}是{type}？',
  COLLECT_SELECT: '请选择{label}：{options}',
  COLLECT_DATE: '请问{label}是哪天？（格式：YYYY-MM-DD）',
  COLLECT_AMOUNT: '请问{label}是多少？',

  // 确认
  CONFIRM_SUBMISSION: '"{processName}"草稿已生成。\n\n表单内容：\n{formData}\n\n确认提交吗？',

  // 成功
  SUBMISSION_SUCCESS: '申请已提交成功！\n\n申请编号：{submissionId}\n流程：{processName}\n\n您可以随时查询申请进度。',

  // 失败
  SUBMISSION_FAILED: '提交失败：{error}\n\n请稍后重试或联系管理员。',

  // 查询
  QUERY_RESULT: '您最近的申请：\n{list}',
  QUERY_EMPTY: '您目前没有进行中的申请。',

  // 操作
  ACTION_SUCCESS: '{action}操作已成功执行！\n\n申请：{processName}\n编号：{submissionId}',
  ACTION_FAILED: '{action}操作失败：{error}',

  // 错误
  INTENT_UNKNOWN: '抱歉，我没有理解您的意图。您可以尝试：\n- 发起申请（如"我要报销差旅费"）\n- 查询进度（如"我的请假申请到哪了"）\n- 撤回申请\n- 催办\n- 补件\n- 转办',
  PROCESS_NOT_FOUND: '当前没有可用的流程模板，请先通过初始化中心导入OA系统。',
  PERMISSION_DENIED: '抱歉，您没有权限发起"{processName}"。\n原因：{reason}',
} as const;

// 建议操作
export const SUGGESTED_ACTIONS = {
  INITIAL: ['发起申请', '查询进度', '查看流程列表'],
  COLLECTING: ['继续填写', '取消'],
  CONFIRMING: ['确认提交', '修改内容', '取消'],
  COMPLETED: ['查询进度', '发起新申请'],
  FAILED: ['重试', '取消'],
  QUERY: ['查看详情', '催办', '发起新申请'],
} as const;

// 停用词（用于关键词提取）
export const STOP_WORDS = [
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
  '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好',
  '自己', '这', '那', '里', '就是', '可以', '什么', '这个', '那个', '怎么',
] as const;

// 时区
export const TIMEZONE = {
  BEIJING: 'Asia/Shanghai',
  UTC: 'UTC',
} as const;

// 日期格式
export const DATE_FORMAT = {
  DATE: 'YYYY-MM-DD',
  DATETIME: 'YYYY-MM-DD HH:mm:ss',
  TIME: 'HH:mm:ss',
  MONTH: 'YYYY-MM',
  YEAR: 'YYYY',
} as const;

// 文件类型
export const FILE_TYPE = {
  IMAGE: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'],
  DOCUMENT: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'],
  ARCHIVE: ['zip', 'rar', '7z', 'tar', 'gz'],
  TEXT: ['txt', 'md', 'csv'],
} as const;

// 文件大小限制（字节）
export const FILE_SIZE_LIMIT = {
  IMAGE: 5 * 1024 * 1024, // 5MB
  DOCUMENT: 10 * 1024 * 1024, // 10MB
  ARCHIVE: 20 * 1024 * 1024, // 20MB
  DEFAULT: 5 * 1024 * 1024, // 5MB
} as const;

// 缓存键前缀
export const CACHE_KEY_PREFIX = {
  SESSION: 'assistant:session:',
  PROCESS: 'assistant:process:',
  SHARED_CONTEXT: 'assistant:shared:',
  USER_STATS: 'assistant:stats:',
} as const;

// 缓存过期时间（秒）
export const CACHE_TTL = {
  SESSION: 3600, // 1小时
  PROCESS: 1800, // 30分钟
  SHARED_CONTEXT: 86400, // 24小时
  USER_STATS: 3600, // 1小时
} as const;

// 日志级别
export const LOG_LEVEL = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
} as const;

// 通知类型
export const NOTIFICATION_TYPE = {
  EMAIL: 'email',
  SMS: 'sms',
  IN_APP: 'in_app',
  WEBHOOK: 'webhook',
} as const;

// 优先级
export const PRIORITY = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  URGENT: 'urgent',
} as const;

// 导出所有常量
export const CONSTANTS = {
  PROCESS_STATUS,
  INTENT_TYPE,
  FIELD_TYPE,
  VALIDATION_TYPE,
  STEP_ACTION,
  PARAMETER_SOURCE,
  AUDIT_ACTION,
  AUDIT_RESULT,
  DEFAULT_CONFIG,
  ERROR_CODE,
  ERROR_MESSAGE,
  STATUS_TEXT,
  ACTION_NAME,
  PROCESS_CATEGORY,
  COMMON_KEYWORDS,
  REGEX_PATTERNS,
  PROMPT_TEMPLATES,
  SUGGESTED_ACTIONS,
  STOP_WORDS,
  TIMEZONE,
  DATE_FORMAT,
  FILE_TYPE,
  FILE_SIZE_LIMIT,
  CACHE_KEY_PREFIX,
  CACHE_TTL,
  LOG_LEVEL,
  NOTIFICATION_TYPE,
  PRIORITY,
} as const;
