-- Keep the persisted global screening prompt position-neutral.
-- Position-specific rules are appended at runtime from the current position context.
UPDATE system_configs
SET prompt_configs = REPLACE(
  prompt_configs,
  '[简历初筛规则版本：keyword-gate-v2] 关键词匹配按三个证据点评估：一、5 年及以上智能硬件/IoT/嵌入式相关产品经验且命中嵌入式固件、IoT 云平台、MQTT 协议、设备端需求、OTA 升级、软硬件联调中的任一关键词；二、明确 ODM/外包/外部研发团队对接和需求管控；三、知名企业背景且实际从事智能硬件、IoT 或嵌入式产品。完整命中至少一项可评 2 分，命中两项可评 3 分，三项均命中可评 4-5 分；关键词匹配 score >= 2 通过该门槛，避坑雷区仍需 score >= 5，最终是否通过由服务端计算。',
  '[简历初筛规则版本：position-aware-v3]\n初筛必须且只能返回以下七个能力维度，每项 score 为 0-5 整数并提供中文事实依据：核心画像、核心职责、任职要求、企业背景、加分项、关键词匹配、避坑雷区。\n「关键词匹配」必须依据当前岗位上下文（岗位职责、岗位要求、个性化需求和能力维度）评估，不得把其他岗位的专属关键词套用到当前岗位。\n如果当前岗位提供岗位专属初筛规则，优先遵循该规则；没有专属规则时，应从当前岗位要求中提取最相关的证据进行判断。\n关键词匹配 2 分或以上通过该门槛，0-1 分不通过；避坑雷区仍需 5 分。其余五项用于计算加权分，最终是否通过由服务端计算；match_score 和 recommendation 仅作非权威参考。'
)
WHERE instr(prompt_configs, '[简历初筛规则版本：keyword-gate-v2]') > 0;
