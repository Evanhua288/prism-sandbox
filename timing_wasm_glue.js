/*!
 * timing_wasm_glue.js —— T-WASM-01 阶段二预置：时机页排盘 WASM 接入层（候选 · 未上线）
 *
 * ★ 总开关（默认关闭）：WASM_TIMING_ENABLED = false
 *   切换条件（须全部满足，见《T-WASM-01阶段二就绪报告 V0.1》§切换前剩余动作清单）：
 *     1. 《A+ 口径落地工单》签署生效（时柱口径民事时落地，ABI 增 hour_basis 参数）；
 *     2. 金标 v1.1（民事时口径）重定 + 22/22 零差异回归通过；
 *     3. 红线 103 条攻击集 WASM 全量回归通过（Node + 浏览器两侧）；
 *     4. v2 线「未作真太阳修正」标注文案回传对齐（v2_outbox 挂账 §八）；
 *     5. 负责人下达切换指令，主线统一推 git 上线。
 *   当前状态：阶段二预置完成，开关关闭，线上沙箱不引用本文件（index.html 未改）。
 *
 * ★ 口径纪律（A+ 工单未签，引擎 cast() 仍按真太阳时 tst 排盘）：
 *   - 本层不写死口径假设：castFromCivil 恒传第 11 参 hourBasis
 *     （0=Civil 默认 / 1=TrueSolar）。现行 ABI 为十参，多余参数按 WebAssembly
 *     JS API 语义被忽略；A+ 落地后 ABI 增至十一参，本层零改动即生效。
 *   - 口径标注义务在展示层（A+ 第 2 条）：标注文案集中在本文件 NOTICE_* 常量，
 *     由 basisNotice() 按实际口径如实给出——签署前任何试跑一律显示 tst 现状标注，
 *     不提前展示「按北京时间排」（引擎尚非民事口径，提前显示即不诚实，违 D-6）。
 *
 * 设计：手写轻 glue（零 wasm-bindgen，守铁律②零外部依赖），ABI 握手与
 * prism/core/prism-wasm/src/lib.rs 注释约定一致：整数定参进、JSON 出
 * （prism_out_ptr/len 读 LAST_OUT 阅后即焚缓冲，读完即失效）。
 *
 * 浏览器与 Node 双端可用（Node 端用于接入前冒烟验证，见就绪报告干跑记录）。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) { module.exports = factory(); }
  else { root.PrismTimingGlue = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ── 总开关（切换条件见文件头注释）─────────────────────────────
  const WASM_TIMING_ENABLED = false;

  // ── 口径参数（A+ 工单方案：Civil 默认 / TrueSolar 可选修正通道）──
  const HOUR_BASIS = { CIVIL: 0, TRUE_SOLAR: 1 };

  // ── 口径标注文案（集中管理，单一事实源；合入正式页前仍须过 P-A-D3-02 白话化门禁）
  // A+ 第 2 条原文（民事时默认 · 签署落地后启用）：
  const NOTICE_CIVIL = "本盘按北京时间排，未作真太阳时修正。";
  const NOTICE_CIVIL_PLAIN = "简单说：我们按钟表上的北京时间算时辰，没有按你出生地的太阳位置再校正。";
  // A+ 第 3 条（可选真太阳修正通道 · 用户自愿填出生地，非本期，预置备用）：
  const NOTICE_TST_OPTIN = "已按出生地真太阳时修正。";
  // 引擎现状如实标注（A+ 工单签署前，一切试跑一律用这条）：
  const NOTICE_TST_CURRENT = "本盘当前按真太阳时排（引擎现状，A+ 口径工单签署后将切换为北京时间口径）。";

  const STEMS = "甲乙丙丁戊己庚辛壬癸";
  const BRANCHES = "子丑寅卯辰巳午未申酉戌亥";
  const ZI_NAMES = ["早子时（按当日）", "晚子时（按次日）", "非子时"];
  const ERR_NAMES = { "-1": "输入字段非法", "-2": "时区非法", "-3": "超出节气表覆盖范围（2020–2035）", "-4": "边界歧义样本" };

  const enc = new TextEncoder(), dec = new TextDecoder();

  /** 加载 wasm 产物，返回 exports（浏览器：同源 fetch，零数据出网）。 */
  async function load(url) {
    // cloud-gate-allow: T-WASM-01（同源加载本地静态 wasm 引擎文件，零数据出网；
    // 冻结令针对个人数据出网调用）
    const res = await fetch(url);
    if (!res.ok) throw new Error("wasm 加载失败 HTTP " + res.status);
    const bytes = await res.arrayBuffer();
    const mod = await WebAssembly.instantiate(bytes, {});
    return mod.instance.exports;
  }

  /** 从 LAST_OUT 缓冲读 JSON（调用 prism_engine_cast 后立即读，阅后即焚）。 */
  function readOut(ex) {
    const ptr = ex.prism_out_ptr(), len = ex.prism_out_len();
    return JSON.parse(dec.decode(new Uint8Array(ex.memory.buffer, ptr, len)));
  }

  /**
   * 民用时排盘主入口。
   * @param ex      wasm exports（load() 返回值；Node 侧可直接 instantiate 传入）
   * @param input   { year,month,day,hour,minute,second } 民用钟面时刻（本地时）
   *                longitudeMicrodeg 出生地经度微度（默认 116407400 = 北京 116.4074°E；
   *                最小采集原则：不默认索取出生地，默认值为时区代表经度）
   *                tzOffsetMinutes  时区偏移（默认 480 = UTC+8）
   *                chinaDst1986_1991 1986–1991 夏令时窗口内出生置 true（钟面已拨快 1h）
   *                hourBasis 口径（HOUR_BASIS；默认 CIVIL——A+ 落地后生效，见文件头纪律）
   * @returns { pillars:{year,month,day,hour:{stem,branch,name}}, tst, civil,
   *            tstCorrectionMs, zi, ziName, rulesVersion, notice }
   */
  function castFromCivil(ex, input) {
    const tz = input.tzOffsetMinutes == null ? 480 : input.tzOffsetMinutes;
    const dst = !!input.chinaDst1986_1991;
    const lon = input.longitudeMicrodeg == null ? 116407400 : input.longitudeMicrodeg;
    const basis = input.hourBasis == null ? HOUR_BASIS.CIVIL : input.hourBasis;

    // 民用 → UTC：减标准偏移；夏令时窗口内钟面已拨快 1h，再减 1h
    const civilMs = Date.UTC(input.year, input.month - 1, input.day,
                             input.hour, input.minute, input.second || 0);
    const utc = new Date(civilMs - (tz + (dst ? 60 : 0)) * 60000);

    const code = ex.prism_engine_cast(
      utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate(),
      utc.getUTCHours(), utc.getUTCMinutes(), utc.getUTCSeconds(),
      lon, tz, dst ? 1 : 0,
      basis, // 第 11 参 hour_basis 预留：现行十参 ABI 忽略之，A+ 落地后生效（见文件头）
    );
    if (code !== 0) {
      const err = new Error("排盘失败：" + (ERR_NAMES[String(code)] || "错误码 " + code));
      err.code = code;
      throw err;
    }
    const r = readOut(ex);
    const pillar = (p) => ({ stem: p[0], branch: p[1], name: STEMS[p[0]] + BRANCHES[p[1]] });
    return {
      pillars: { year: pillar(r.year), month: pillar(r.month), day: pillar(r.day), hour: pillar(r.hour) },
      tst: r.tst, civil: r.civil, tstCorrectionMs: r.tst_correction_ms,
      zi: r.zi, ziName: ZI_NAMES[r.zi], rulesVersion: r.rules_version,
      notice: basisNotice(basis),
    };
  }

  /**
   * 口径标注（展示层义务）。签署前：无论选哪档，一律附 tst 现状标注——
   * 引擎尚非民事口径，不允许提前显示「按北京时间排」（诚实哲学 D-6）。
   */
  function basisNotice(hourBasis) {
    if (hourBasis === HOUR_BASIS.TRUE_SOLAR) {
      return { text: NOTICE_TST_CURRENT, plain: "", basis: "true_solar_current" };
    }
    // CIVIL（默认）：A+ 落地前如实降级为现状标注；落地后改返回 NOTICE_CIVIL
    // （一行切换，见《A+ 口径落地工单 V0.1》§三 E4）
    return { text: NOTICE_TST_CURRENT, plain: "", basis: "civil_pending_a_plus" };
  }

  return {
    WASM_TIMING_ENABLED, HOUR_BASIS,
    NOTICE_CIVIL, NOTICE_CIVIL_PLAIN, NOTICE_TST_OPTIN, NOTICE_TST_CURRENT,
    STEMS, BRANCHES, ZI_NAMES,
    load, castFromCivil, basisNotice,
  };
});
