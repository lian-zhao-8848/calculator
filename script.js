class Calculator {
  /**
   * @param {{ displayEl: HTMLElement, historyEl: HTMLElement | null, keypadEl: HTMLElement }} opts
   */
  constructor({ displayEl, historyEl, keypadEl }) {
    this.displayEl = displayEl;
    this.historyEl = historyEl ?? null;
    this.keypadEl = keypadEl;
    this.baseDisplayFontSize = 42;
    this.minDisplayFontSize = 14;

    this.resetAll();
    this.bindEvents();
    this.bindKeyboardEvents();
    this.updateDisplay();
  }

  resetAll() {
    this.accumulator = null; // number (已计算结果)
    this.pendingOperator = null; // '+', '-', '*', '/'
    this.currentInput = ""; // string（正在输入的数字）
    this.justEvaluated = false; // 是否刚按下’=‘

    // 用于重复按 '='（可选但能增强体验）
    this.lastOperator = null;
    this.lastOperand = null;
    this.historyText = "";
    this.expressionTokens = [];
    this.isShowingResult = false;

    this.error = null; // '错误' 等
  }

  bindEvents() {
    this.keypadEl.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;

      if (this.error) {
        // 除了 AC 以外的输入都忽略，避免状态混乱
        const action = btn.dataset.action;
        if (action !== "ac") return;
      }

      const action = btn.dataset.action;
      if (action === "digit") this.handleDigit(btn.dataset.digit);
      else if (action === "decimal") this.handleDecimal();
      else if (action === "op") this.handleOperator(btn.dataset.op);
      else if (action === "equals") this.handleEquals();
      else if (action === "ac") this.handleAC();
      else if (action === "neg") this.handleNeg();
      else if (action === "percent") this.handlePercent();
      else if (action === "backspace") this.handleBackspace();
    });
  }

  bindKeyboardEvents() {
    if (typeof document === "undefined") return;

    document.addEventListener("keydown", (e) => {
      // 输入框内不拦截，避免影响用户正常输入
      const target = e.target;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      const { key, code } = e;
      let handled = true;

      if (/^\d$/.test(key)) {
        this.handleDigit(key);
      } else if (key === "." || code === "NumpadDecimal") {
        this.handleDecimal();
      } else if (key === "+" || key === "-" || key === "*" || key === "/") {
        this.handleOperator(key);
      } else if (key === "x" || key === "X") {
        this.handleOperator("*");
      } else if (key === "%" || key === "p" || key === "P") {
        this.handlePercent();
      } else if (key === "Enter" || key === "=") {
        this.handleEquals();
      } else if (key === "Backspace") {
        this.handleBackspace();
      } else if (key === "Escape" || key.toLowerCase() === "c") {
        this.handleAC();
      } else if (key.toLowerCase() === "n") {
        this.handleNeg();
      } else {
        handled = false;
      }

      if (handled) e.preventDefault();
    });
  }

  // ---------- Input ----------

  handleAC() {
    this.resetAll();
    this.updateDisplay();
  }

  handleBackspace() {
    if (this.error) return;

    // 结果态也允许退格：先把结果转成可编辑输入
    if (this.currentInput === "") {
      if (this.pendingOperator !== null || this.accumulator === null) return;
      this.currentInput = this.numberToInputString(this.accumulator);
      this.accumulator = null;
      this.clearHistoryAndExpression();
    }

    this.currentInput = this.currentInput.slice(0, -1);
    if (this.currentInput === "-") this.currentInput = "";
    this.markEditing();
    this.updateDisplay();
  }

  handleDigit(digit) {
    if (this.error) {
      this.resetAll();
    }

    const d = String(digit);
    const isZero = d === "0";

    if (this.justEvaluated && this.pendingOperator === null) {
      // equals 后直接输入新数字
      this.startNewEntry(d === "0" ? "0" : d);
      this.updateDisplay();
      return;
    }

    // 百分号输入已完成后，再输入数字则开启新的数字输入
    if (this.currentInput.endsWith("%")) {
      this.currentInput = d;
      this.markEditing();
      this.updateDisplay();
      return;
    }

    if (this.currentInput === "0") {
      // 避免开头出现多余 0
      this.currentInput = isZero ? "0" : d;
    } else if (this.currentInput === "" || this.justEvaluated) {
      // 刚按过运算符/或者 equals 后，开始输入 rhs
      this.currentInput = d;
      this.markEditing();
    } else {
      this.currentInput += d;
    }

    this.updateDisplay();
  }

  handleDecimal() {
    if (this.error) {
      this.resetAll();
    }

    if (this.justEvaluated && this.pendingOperator === null) {
      // equals 后开始新输入
      this.startNewEntry("0.");
      this.updateDisplay();
      return;
    }

    // 百分号输入已完成后，再输入小数点则开启新的小数输入
    if (this.currentInput.endsWith("%")) {
      this.currentInput = "0.";
      this.markEditing();
      this.updateDisplay();
      return;
    }

    if (this.currentInput === "") {
      this.currentInput = "0.";
      this.markEditing();
      this.updateDisplay();
      return;
    }

    if (!this.currentInput.includes(".")) {
      this.currentInput += ".";
      this.updateDisplay();
    }
  }

  handleNeg() {
    if (this.error) return;

    if (this.currentInput !== "") {
      // 切换当前输入正负
      if (this.currentInput.startsWith("-"))
        this.currentInput = this.currentInput.slice(1);
      else this.currentInput = "-" + this.currentInput;
    } else {
      // 已有运算符但还未输入 rhs：忽略 neg，避免出现多符号（如 9×-）
      if (this.pendingOperator !== null) {
        return;
      }

      // 当前没有 pending：切换当前结果/左值的正负
      const active = this.getActiveNumber();
      this.accumulator = -active;
      this.justEvaluated = true;
      this.isShowingResult = false;
    }

    this.updateDisplay();
  }

  handlePercent() {
    if (this.error) return;

    // 输入态：先标记为百分号，不立即转成小数
    if (this.currentInput !== "") {
      if (this.currentInput === "-" || this.currentInput === "+") return;
      if (this.currentInput.endsWith("%")) return;
      this.currentInput += "%";
      this.justEvaluated = false;
      this.isShowingResult = false;
      this.updateDisplay();
      return;
    }

    // 有待运算但没有 rhs：忽略，避免形成 9×% 这种无意义状态
    if (this.pendingOperator !== null) return;

    // 无输入时：对当前值添加百分号展示，等计算时再转换
    const base = this.accumulator ?? 0;
    this.currentInput = `${this.numberToInputString(base)}%`;
    this.justEvaluated = false;
    this.isShowingResult = false;
    this.updateDisplay();
  }

  // ---------- Operators ----------

  handleOperator(op) {
    if (this.error) return;

    const operator = this.normalizeOperator(op);
    if (!operator) return;

    // equals 后开始新一轮表达式
    if (this.justEvaluated && this.pendingOperator === null) {
      const lhs = this.accumulator ?? 0;
      this.pendingOperator = operator;
      this.currentInput = "";
      this.markEditing();
      this.clearHistoryAndExpression();
      this.expressionTokens = [lhs, operator];
      this.updateDisplay();
      return;
    }

    if (!this.pushCurrentInputToExpressionTokens() && this.expressionTokens.length === 0) {
      const lhs = this.accumulator ?? 0;
      this.expressionTokens.push(lhs);
    }

    // 尾部运算符替换（连续按 op）
    if (this.expressionTokens.length > 0) {
      if (typeof this.expressionTokens[this.expressionTokens.length - 1] === "string") {
        this.expressionTokens[this.expressionTokens.length - 1] = operator;
      } else {
        this.expressionTokens.push(operator);
      }
    }

    // 用当前 token 的最后一个数字作为“当前结果显示基准”
    if (typeof this.expressionTokens[0] === "number") {
      const lastNumber = [...this.expressionTokens].reverse().find((t) => typeof t === "number");
      this.accumulator = typeof lastNumber === "number" ? lastNumber : this.accumulator;
    }

    this.pendingOperator = operator;
    this.markEditing();
    this.updateDisplay();
  }

  handleEquals() {
    if (this.error) return;

    // 仅百分号输入（无 pending）时，按等号后再转换
    if (this.pendingOperator === null && this.currentInput.endsWith("%")) {
      const percentExpr = this.formatInputForDisplay(this.currentInput);
      const result = this.parseNumber(this.currentInput);
      this.setComputedResult(result, percentExpr);
      this.updateDisplay();
      return;
    }

    // 如果有 pending，就用它计算一次
    if (this.pendingOperator !== null) {
      if (!this.pushCurrentInputToExpressionTokens() && typeof this.expressionTokens[this.expressionTokens.length - 1] === "string") {
        // a op = 时复用上次右值或自身
        const fallback =
          this.lastOperand !== null
            ? this.lastOperand
            : typeof this.expressionTokens[this.expressionTokens.length - 2] === "number"
              ? this.expressionTokens[this.expressionTokens.length - 2]
              : this.accumulator ?? 0;
        this.expressionTokens.push(fallback);
      }

      const result = this.evaluateExpressionTokens(this.expressionTokens);
      if (this.error) {
        this.updateDisplay();
        return;
      }

      let nextLastOperator = this.lastOperator;
      let nextLastOperand = this.lastOperand;
      if (this.expressionTokens.length >= 3) {
        nextLastOperator = this.expressionTokens[this.expressionTokens.length - 2];
        nextLastOperand = this.expressionTokens[this.expressionTokens.length - 1];
      }

      this.setComputedResult(
        result,
        this.formatExpressionFromTokens(this.expressionTokens),
      );
      this.lastOperator = nextLastOperator;
      this.lastOperand = nextLastOperand;

      this.updateDisplay();
      return;
    }

    // 没有 pending：支持重复按 '='（比如 2 + 3 = = -> 8）
    if (
      this.lastOperator !== null &&
      this.accumulator !== null &&
      this.lastOperand !== null
    ) {
      const lhs = this.accumulator;
      const result = this.compute(lhs, this.lastOperand, this.lastOperator);
      if (this.error) {
        this.updateDisplay();
        return;
      }
      this.setComputedResult(
        result,
        `${this.formatNumberForDisplay(lhs)}${this.formatOperatorForDisplay(this.lastOperator)}${this.formatNumberForDisplay(this.lastOperand)}`,
      );
      this.updateDisplay();
    }
  }

  // ---------- Helpers ----------

  normalizeOperator(op) {
    const map = {
      "+": "+",
      "-": "-",
      "*": "*",
      "/": "/",
      "÷": "/",
      "×": "*",
    };
    return map[op] ?? null;
  }

  formatOperatorForDisplay(op) {
    if (op === "*") return "×";
    if (op === "/") return "÷";
    return op;
  }

  formatExpressionFromTokens(tokens) {
    return tokens
      .map((t) =>
        typeof t === "number"
          ? this.formatNumberForDisplay(t)
          : this.formatOperatorForDisplay(t),
      )
      .join("");
  }

  getActiveNumber() {
    if (this.currentInput !== "") return this.parseNumber(this.currentInput);
    if (this.accumulator !== null) return this.accumulator;
    return 0;
  }

  parseNumber(s) {
    // 仅处理我们自己产生的数字串
    if (s === "-" || s === "+") return 0;
    if (s.endsWith("%")) {
      const base = Number(s.slice(0, -1));
      if (!Number.isFinite(base)) return 0;
      return this.normalizeDisplayNumber(base / 100);
    }
    const n = Number(s);
    return n;
  }

  numberToInputString(n) {
    if (Object.is(n, -0) || n === 0) return "0";
    return String(n);
  }

  clearHistoryAndExpression() {
    this.historyText = "";
    this.expressionTokens = [];
  }

  markEditing() {
    this.justEvaluated = false;
    this.isShowingResult = false;
  }

  startNewEntry(inputValue) {
    this.currentInput = inputValue;
    this.accumulator = null;
    this.markEditing();
    this.clearHistoryAndExpression();
  }

  setComputedResult(result, historyText) {
    this.accumulator = result;
    this.pendingOperator = null;
    this.currentInput = "";
    this.justEvaluated = true;
    this.isShowingResult = true;
    this.historyText = historyText;
    this.expressionTokens = [];
  }

  pushCurrentInputToExpressionTokens() {
    if (this.currentInput === "") return false;
    const value = this.parseNumber(this.currentInput);
    if (this.expressionTokens.length === 0) {
      this.expressionTokens.push(value);
    } else if (typeof this.expressionTokens[this.expressionTokens.length - 1] === "string") {
      this.expressionTokens.push(value);
    } else {
      this.expressionTokens[this.expressionTokens.length - 1] = value;
    }
    this.currentInput = "";
    return true;
  }

  compute(lhs, rhs, op) {
    let result;
    switch (op) {
      case "+":
        result = lhs + rhs;
        break;
      case "-":
        result = lhs - rhs;
        break;
      case "*":
        result = lhs * rhs;
        break;
      case "/":
        if (rhs === 0) {
          this.error = "错误";
          result = null;
          return result;
        }
        result = lhs / rhs;
        break;
      default:
        this.error = "错误";
        result = null;
        return result;
    }

    if (!Number.isFinite(result)) {
      this.error = "错误";
      return null;
    }

    // 去掉浮点显示中多余尾随 0（保留合理精度）
    return this.normalizeDisplayNumber(result);
  }

  evaluateExpressionTokens(tokens) {
    if (!tokens.length) return 0;

    const pass = [];
    let acc = tokens[0];
    for (let i = 1; i < tokens.length; i += 2) {
      const op = tokens[i];
      const num = tokens[i + 1];
      if (op === "*" || op === "/") {
        acc = this.compute(acc, num, op);
        if (this.error) return null;
      } else {
        pass.push(acc, op);
        acc = num;
      }
    }
    pass.push(acc);

    let result = pass[0];
    for (let i = 1; i < pass.length; i += 2) {
      result = this.compute(result, pass[i + 1], pass[i]);
      if (this.error) return null;
    }
    return result;
  }

  normalizeDisplayNumber(n) {
    // 用 15 位有效数字消除常见二进制浮点尾差（如 0.3 + 0.6）
    const s = n.toPrecision(15);
    const num = Number(s);
    if (Math.abs(num) < 1e-12) return 0;
    return num;
  }

  formatNumberForDisplay(value, wrapNegative = true) {
    if (this.error) return this.error;
    if (value === null || value === undefined) return "0";

    // 可能是整数，也可能是小数
    if (!Number.isFinite(value)) return "错误";
    if (Object.is(value, -0)) value = 0;

    // 使用字符串处理尾随 0 问题
    let s = String(value);
    if (s.includes("e") || s.includes("E")) {
      // 避免科学计数法太难读
      s = value.toFixed(12).replace(/\.?0+$/, "");
    }
    // 常规小数：裁掉尾随 0
    if (s.includes(".")) s = s.replace(/\.?0+$/, "");
    const formatted = this.formatNumericStringWithGrouping(s);
    return wrapNegative ? this.wrapNegativeForDisplay(formatted) : formatted;
  }

  formatNumericStringWithGrouping(s) {
    const isNegative = s.startsWith("-");
    const raw = isNegative ? s.slice(1) : s;
    const hasDot = raw.includes(".");
    const parts = raw.split(".");
    const intPart = parts[0] || "0";
    const fracPart = parts[1] ?? "";
    const groupedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const sign = isNegative ? "-" : "";
    if (hasDot) return `${sign}${groupedInt}.${fracPart}`;
    return `${sign}${groupedInt}`;
  }

  formatInputForDisplay(rawInput) {
    if (rawInput === "") return "";
    if (rawInput === "-" || rawInput === "+") return rawInput;
    if (rawInput.endsWith("%")) {
      const base = rawInput.slice(0, -1);
      return `${this.wrapNegativeForDisplay(this.formatNumericStringWithGrouping(base))}%`;
    }
    return this.wrapNegativeForDisplay(
      this.formatNumericStringWithGrouping(rawInput),
    );
  }

  wrapNegativeForDisplay(s) {
    if (s.startsWith("-")) return `(${s})`;
    return s;
  }

  applyDisplayFontSize(displayText) {
    let size = this.baseDisplayFontSize;
    this.displayEl.style.fontSize = `${size}px`;

    // 在真实 DOM 中按可用宽度自适应字号；测试桩对象则跳过测量
    if (
      typeof this.displayEl.clientWidth === "number" &&
      typeof this.displayEl.scrollWidth === "number"
    ) {
      while (size > this.minDisplayFontSize && this.displayEl.scrollWidth > this.displayEl.clientWidth) {
        size -= 1;
        this.displayEl.style.fontSize = `${size}px`;
      }

      const isOverflow = this.displayEl.scrollWidth > this.displayEl.clientWidth;
      this.displayEl.classList.toggle("display__value--overflow", isOverflow);
      return;
    }

    const digitCount = (displayText.match(/\d/g) || []).length;
    if (digitCount > 9) {
      size = this.baseDisplayFontSize - (digitCount - 9) * 1.8;
    }
    this.displayEl.style.fontSize = `${Math.max(this.minDisplayFontSize, size)}px`;
  }

  getExpressionPreview() {
    if (this.expressionTokens.length === 0 && this.pendingOperator === null) return "";
    return `${this.formatExpressionFromTokens(this.expressionTokens)}${this.formatInputForDisplay(this.currentInput)}`;
  }

  updateDisplay() {
    if (this.historyEl) {
      this.historyEl.textContent = this.historyText;
    }

    if (this.error) {
      const text = this.formatNumberForDisplay(null);
      this.displayEl.textContent = text;
      this.applyDisplayFontSize(text);
      return;
    }

    // 还没有历史记录时，把当前过程放在主显示区展示
    if (this.historyText === "" && this.pendingOperator !== null) {
      const text = this.getExpressionPreview();
      this.displayEl.textContent = text;
      this.applyDisplayFontSize(text);
      return;
    }

    // 输入态优先显示原始串，确保 "0." 这类未完成小数也能直接看到
    if (this.currentInput !== "") {
      const text = this.formatInputForDisplay(this.currentInput);
      this.displayEl.textContent = text;
      this.applyDisplayFontSize(text);
      return;
    }

    const active = this.getActiveNumber();
    const text = this.formatNumberForDisplay(active, !this.isShowingResult);
    this.displayEl.textContent = text;
    this.applyDisplayFontSize(text);
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    const displayEl = document.querySelector("[data-display]");
    const historyEl = document.querySelector("[data-history]");
    const keypadEl = document.querySelector("[data-keypad]");
    if (!displayEl || !keypadEl) return;
    new Calculator({ displayEl, historyEl, keypadEl });
  });
}
