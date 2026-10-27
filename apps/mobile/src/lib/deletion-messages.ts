export const deletionZh = {
  deleteAccount: "删除账号", deletionScope: "将永久删除账号、资料、头像、训练和饮食计划、身体/饮食/训练记录及对话. 本机待同步记录也会清理，其他账号和访客数据保留. 已导出副本或服务商备份不属于本次在线删除范围，保存期限请查看隐私说明或联系支持.",
  deletionConfirm: "我确认永久删除此账号及上述数据", deletionPassword: "当前账号密码", deletionSubmit: "确认并永久删除",
  deletionUnavailable: "账号删除暂未启用. 请稍后回来检查.", deletionPending: "删除处理中或结果待核实. 普通同步已暂停，请保留此页面和应用数据，联网后重试.",
  deletionExpired: "账号尚未删除，继续删除需要重新验证当前账号密码. 请保留应用数据和恢复凭据.",
  deletionUnknown: "结果尚未确认. 请保留应用数据并重试，当前不会报告删除完成.", deletionAuth: "密码验证失败，或账号已变化. 请核对当前账号.",
  deletionDone: "账号已删除，本机该账号数据已清理.", deletionResume: "重试核实并完成清理", deletionLocal: "无法读取本机删除状态. 普通同步暂未启动，请重试.",
  deletionWeb: "没有此账号的密码？请在网页重新登录后进入账号删除页面.", deletionWebOpen: "在网页继续", deletionBack: "返回", deletionBusy: "正在处理…",
};
export const deletionEn: Record<keyof typeof deletionZh, string> = {
  deleteAccount: "Delete account", deletionScope: "Permanently delete your account, profile, avatar, training and nutrition plans, body/food/workout records and conversations. Pending records on this device are removed; other accounts and guest data remain. Exported copies and provider backups are outside this online deletion. See the privacy notice or contact support about retention.",
  deletionConfirm: "I confirm permanent deletion of this account and the data above", deletionPassword: "Current account password", deletionSubmit: "Confirm permanent deletion",
  deletionUnavailable: "Account deletion is not enabled yet. Please check again later.", deletionPending: "Deletion is pending or its outcome is unknown. Ordinary sync is paused. Keep the app data and retry when online.",
  deletionExpired: "The account still exists. Verify its password again to continue deletion. Keep the app data and recovery receipt.",
  deletionUnknown: "The outcome is not confirmed. Keep the app data and retry. Deletion is not reported as complete.", deletionAuth: "Password verification failed or the selected account changed. Check the account.",
  deletionDone: "Account deleted. Its data on this device has been cleared.", deletionResume: "Retry verification and cleanup", deletionLocal: "Cannot read local deletion state. Ordinary sync has not started. Please retry.",
  deletionWeb: "No password for this account? Sign in again on the website and open account deletion.", deletionWebOpen: "Continue on website", deletionBack: "Back", deletionBusy: "Working…",
};
