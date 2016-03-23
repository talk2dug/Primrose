/* global qp, Primrose, isOSX, isIE, isOpera, isChrome, isFirefox, isSafari, devicePixelRatio, HTMLCanvasElement, pliny */

Primrose.Text.Controls.TextBox = (function () {
  "use strict";

  var SCROLL_SCALE = isFirefox ? 3 : 100,
    COUNTER = 0;

  pliny.class("Primrose.Text.Controls", {
    name: "TextBox",
    description: "Syntax highlighting textbox control.",
    parameters: [
      { name: "idOrCanvasOrContext", type: "String or HTMLCanvasElement or CanvasRenderingContext2D", description: "Either an ID of an element that exists, an element, or the ID to set on an element that is to be created." },
      { name: "options", type: "Object", description: "Named parameters for creating the TextBox." }
    ]
  });
  class TextBox extends Primrose.Surface {
    constructor(options) {
      super(patch(options, {
        id: "Primrose.Text.Controls.TextBox[" + (COUNTER++) + "]"
      }));
      this.listeners.change = [];
      ////////////////////////////////////////////////////////////////////////
      // normalize input parameters
      ////////////////////////////////////////////////////////////////////////
    
      if (typeof options === "string") {
        this.options = { value: this.options };
      }
      else {
        this.options = options || {};
      }

      var makeCursorCommand = function (name) {
        var method = name.toLowerCase();
        this["cursor" + name] = function (lines, cursor) {
          cursor[method](lines);
          this.scrollIntoView(cursor);
        };
      };

      ["Left", "Right",
        "SkipLeft", "SkipRight",
        "Up", "Down",
        "Home", "End",
        "FullHome", "FullEnd"].map(makeCursorCommand.bind(this));

      ////////////////////////////////////////////////////////////////////////
      // initialization
      ///////////////////////////////////////////////////////////////////////
      this.tokens = null;
      this.lines = null;
      this._commandPack = null;
      this._tokenRows = null;
      this._tokenHashes = null;
      this._tabString = null;
      this._currentTouchID = null;
      this._lineCountWidth = null;

      this._lastFont = null;
      this._lastText = null;
      this._lastCharacterWidth = null;
      this._lastCharacterHeight = null;
      this._lastGridBounds = null;
      this._lastPadding = null;
      this._lastFrontCursorI = -1;
      this._lastBackCursorI = -1;
      this._lastWidth = -1;
      this._lastHeight = -1;
      this._lastScrollX = -1;
      this._lastScrollY = -1;
      this._lastFocused = false;
      this._lastPointer = new Primrose.Text.Point();
            
      // different browsers have different sets of keycodes for less-frequently
      // used keys like curly brackets.
      this._browser = isChrome ? "CHROMIUM" : (isFirefox ? "FIREFOX" : (isIE ? "IE" : (isOpera ? "OPERA" : (isSafari ? "SAFARI" : "UNKNOWN"))));
      this._pointer = new Primrose.Text.Point();
      this._deadKeyState = "";
      this._history = [];
      this._historyFrame = -1;
      this._topLeftGutter = new Primrose.Text.Size();
      this._bottomRightGutter = new Primrose.Text.Size();
      this._dragging = false;
      this._scrolling = false;
      this._wheelScrollSpeed = 4;
      var subBounds = new Primrose.Text.Rectangle(0, 0, this.bounds.width, this.bounds.height);
      this._fg = new Primrose.Surface({
        id: this.id + "-fore",
        bounds: subBounds
      });
      this._fgCanvas = this._fg.canvas;
      this._fgfx = this._fg.context;
      this._bg = new Primrose.Surface({
        id: this.id + "-back",
        bounds: subBounds
      });
      this._bgCanvas = this._bg.canvas;
      this._bgfx = this._bg.context;
      this._trim = new Primrose.Surface({
        id: this.id + "-trim",
        bounds: subBounds
      });
      this._trimCanvas = this._trim.canvas;
      this._tgfx = this._trim.context;
      this._rowCache = {};
      this._VSCROLL_WIDTH = 2;

      this.tabWidth = this.options.tabWidth;
      this.showLineNumbers = !this.options.hideLineNumbers;
      this.showScrollBars = !this.options.hideScrollBars;
      this.wordWrap = !this.options.disableWordWrap;
      this.readOnly = !!this.options.readOnly;
      this.multiline = !this.options.singleLine;
      this.gridBounds = new Primrose.Text.Rectangle();
      this.frontCursor = new Primrose.Text.Cursor();
      this.backCursor = new Primrose.Text.Cursor();
      this.scroll = new Primrose.Text.Point();
      this.character = new Primrose.Text.Size();
      this.theme = this.options.theme;
      this.fontSize = this.options.fontSize;
      this.tokenizer = this.options.tokenizer;
      this.commandPack = this.options.commands || Primrose.Text.CommandPacks.TextEditor;
      this.value = this.options.value;
      this.padding = this.options.padding || 1;

      this.addEventListener("focus", this.render.bind(this), false);
      this.addEventListener("blur", this.render.bind(this), false);
    }

    cursorPageUp(lines, cursor) {
      cursor.incY(-this.gridBounds.height, lines);
      this.scrollIntoView(cursor);
    }

    cursorPageDown(lines, cursor) {
      cursor.incY(this.gridBounds.height, lines);
      this.scrollIntoView(cursor);
    }

    setDeadKeyState(st) {
      this._deadKeyState = st || "";
    }

    get value() {
      return this._history[this._historyFrame].join("\n");
    }

    set value(txt) {
      txt = txt || "";
      txt = txt.replace(/\r\n/g, "\n");
      if (!this.multiline) {
        txt = txt.replace(/\n/g, "");
      }
      var lines = txt.split("\n");
      this.pushUndo(lines);
      this.render();
      emit.call(this, "change", { target: this });
    }

    get selectedText() {
      var minCursor = Primrose.Text.Cursor.min(this.frontCursor, this.backCursor),
        maxCursor = Primrose.Text.Cursor.max(this.frontCursor, this.backCursor);
      return this.value.substring(minCursor.i, maxCursor.i);
    }

    set selectedText(str) {
      str = str || "";
      str = str.replace(/\r\n/g, "\n");

      if (this.frontCursor.i !== this.backCursor.i || str.length > 0) {
        var minCursor = Primrose.Text.Cursor.min(this.frontCursor, this.backCursor),
          maxCursor = Primrose.Text.Cursor.max(this.frontCursor, this.backCursor),
          // TODO: don't recalc the string first.
          text = this.value,
          left = text.substring(0, minCursor.i),
          right = text.substring(maxCursor.i);

        var v = left + str + right;
        this.value = v;
        this.refreshGridBounds();
        this.performLayout();
        minCursor.advanceN(this.lines, Math.max(0, str.length));
        this.scrollIntoView(maxCursor);
        this.clampScroll();
        maxCursor.copy(minCursor);
        this.render();
      }
    }

    get padding() {
      return this._padding;
    }

    set padding(v) {
      this._padding = v;
      this.render();
    }

    get wordWrap() {
      return this._wordWrap;
    }

    set wordWrap(v) {
      this._wordWrap = v || false;
      this.setGutter();
    }

    get showLineNumbers() {
      return this._showLineNumbers;
    }

    set showLineNumbers(v) {
      this._showLineNumbers = v;
      this.setGutter();
    }

    get showScrollBars() {
      return this._showScrollBars;
    }

    set showScrollBars(v) {
      this._showScrollBars = v;
      this.setGutter();
    }

    get theme() {
      return this._theme;
    }

    set theme(t) {
      this._theme = clone(t || Primrose.Text.Themes.Default);
      this._theme.fontSize = this.fontSize;
      this.resize();
      this.render();
    }

    get commandPack() {
      return this._commandPack;
    }

    set commandPack(v) {
      this._commandPack = v;
    }

    get selectionStart() {
      return this.frontCursor.i;
    }

    set selectionStart(i) {
      this.frontCursor.setI(i, this.lines);
    }

    get selectionEnd() {
      return this.backCursor.i;
    }

    set selectionEnd(i) {
      this.backCursor.setI(i, this.lines);
    }

    get selectionDirection() {
      return this.frontCursor.i <= this.backCursor.i ? "forward" : "backward";
    }

    get tokenizer() {
      return this._tokenizer;
    }

    set tokenizer(tk) {
      this._tokenizer = tk || Primrose.Text.Grammars.JavaScript;
      if (this._history && this._history.length > 0) {
        this.refreshTokens();
        this.render();
      }
    }

    get tabWidth() {
      return this._tabWidth;
    }

    set tabWidth(tw) {
      this._tabWidth = tw || 4;
      this._tabString = "";
      for (var i = 0; i < this._tabWidth; ++i) {
        this._tabString += " ";
      }
    }

    get tabString() {
      return this._tabString;
    }

    get fontSize() {
      return this._fontSize || 16;
    }

    set fontSize(v) {
      v = v || 16;
      this._fontSize = v;
      if (this.theme) {
        this.theme.fontSize = this._fontSize;
        this.resize();
        this.render();
      }
    }

    get lockMovement() {
      return this.focused && !this.readOnly;
    }

    pushUndo(lines) {
      if (this._historyFrame < this._history.length - 1) {
        this._history.splice(this._historyFrame + 1);
      }
      this._history.push(lines);
      this._historyFrame = this._history.length - 1;
      this.refreshTokens();
      this.render();
    }

    redo() {
      if (this._historyFrame < this._history.length - 1) {
        ++this._historyFrame;
      }
      this.refreshTokens();
      this.fixCursor();
      this.render();
    }

    undo() {
      if (this._historyFrame > 0) {
        --this._historyFrame;
      }
      this.refreshTokens();
      this.fixCursor();
      this.render();
    }

    scrollIntoView(currentCursor) {
      this.scroll.y += this.minDelta(currentCursor.y, this.scroll.y, this.scroll.y + this.gridBounds.height);
      if (!this.wordWrap) {
        this.scroll.x += this.minDelta(currentCursor.x, this.scroll.x, this.scroll.x + this.gridBounds.width);
      }
      this.clampScroll();
    }

    readWheel(evt) {
      if (this.focused) {
        if (evt.shiftKey || isChrome) {
          this.fontSize += evt.deltaX / SCROLL_SCALE;
        }
        if (!evt.shiftKey || isChrome) {
          this.scroll.y += Math.floor(evt.deltaY * this._wheelScrollSpeed / SCROLL_SCALE);
        }
        this.clampScroll();
        this.render();
        evt.preventDefault();
      }
    }

    startPointer(x, y) {
      if (!super.startPointer(x, y)) {
        this._dragging = true;
        this.setCursorXY(this.frontCursor, x, y);
      }
    }

    movePointer(x, y) {
      if (this._dragging) {
        this.setCursorXY(this.backCursor, x, y);
      }
    }

    endPointer() {
      super.endPointer();
      this._dragging = false;
      this._scrolling = false;
    }

    bindEvents(elem) {
      if (elem instanceof HTMLCanvasElement && (elem.tabindex === undefined || elem.tabindex === null)) {
        elem.tabindex = 0;
      }

      BrowserEnvironment.createSurrogate.call(this);

      elem.addEventListener("wheel", this.readWheel.bind(this), false);
      elem.addEventListener("mousedown", this.mouseButtonDown.bind(this), false);
      elem.addEventListener("mousemove", this.mouseMove.bind(this), false);
      elem.addEventListener("mouseup", this.mouseButtonUp.bind(this), false);
      elem.addEventListener("touchstart", this.touchStart.bind(this), false);
      elem.addEventListener("touchmove", this.touchMove.bind(this), false);
      elem.addEventListener("touchend", this.touchEnd.bind(this), false);
      elem.addEventListener("keydown", this.keyDown.bind(this), false);
      elem.addEventListener("beforepaste", (evt) => evt.returnValue = false, false);
      elem.addEventListener("paste", this.readClipboard.bind(this), false);
      elem.addEventListener("keydown", (evt) => {
        var os = isOSX ? Primrose.Text.OperatingSystems.OSX : Primrose.Text.OperatingSystems.Windows;
        if (this.focused && os.isClipboardReadingEvent(evt)) {
          this._surrogate.style.display = "block";
          this._surrogate.focus();
        }
      }, true);
    }

    copySelectedText(evt) {
      if (this.focused && this.frontCursor.i !== this.backCursor.i) {
        var clipboard = evt.clipboardData || window.clipboardData;
        clipboard.setData(
          window.clipboardData ? "Text" : "text/plain", this.selectedText);
        evt.returnValue = false;
      }
    }

    cutSelectedText(evt) {
      if (this.focused) {
        this.copySelectedText(evt);
        if (!this.readOnly) {
          this.selectedText = "";
        }
      }
    }

    execCommand(browser, codePage, commandName) {
      if (commandName && this.focused && !this.readOnly) {
        var altCommandName = browser + "_" + commandName,
          func = this.commandPack[altCommandName] ||
            this.commandPack[commandName] ||
            codePage[altCommandName] ||
            codePage[commandName];

        if (func instanceof String || typeof func === "string") {
          console.log("okay");
          func = this.commandPack[func] ||
            this.commandPack[func] ||
            func;
        }
        
        if (func === undefined) {
          return false;
        }
        else {
          this.frontCursor.moved = false;
          this.backCursor.moved = false;
          if (func instanceof Function) {
            func(this, this.lines);
          }
          else if (func instanceof String || typeof func === "string") {
            console.log(func);
            this.selectedText = func;
          }
          if (this.frontCursor.moved && !this.backCursor.moved) {
            this.backCursor.copy(this.frontCursor);
          }
          this.clampScroll();
          this.render();
          return true;
        }
      }
    }

    readClipboard(evt) {
      if (this.focused && !this.readOnly) {
        evt.returnValue = false;
        var clipboard = evt.clipboardData || window.clipboardData,
          str = clipboard.getData(window.clipboardData ? "Text" : "text/plain");
        if (str) {
          this.selectedText = str;
        }
      }
    }

    resize() {
      super.resize();
      this._bg.setSize(this.surfaceWidth, this.surfaceHeight);
      this._fg.setSize(this.surfaceWidth, this.surfaceHeight);
      this._trim.setSize(this.surfaceWidth, this.surfaceHeight);
      if (this.theme) {
        this.character.height = this.fontSize;
        this.context.font = this.character.height + "px " + this.theme.fontFamily;
        // measure 100 letter M's, then divide by 100, to get the width of an M
        // to two decimal places on systems that return integer values from
        // measureText.
        this.character.width = this.context.measureText(
          "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM").width /
          100;
      }
      this.render();
    }

    pixel2cell(point) {
      const x = point.x * this.imageWidth / this.surfaceWidth,
        y = point.y * this.imageHeight / this.surfaceHeight;
      point.set(
        Math.round(point.x / this.character.width) + this.scroll.x - this.gridBounds.x,
        Math.floor((point.y / this.character.height) - 0.25) + this.scroll.y);
    }

    clampScroll() {
      if (this.scroll.y < 0) {
        this.scroll.y = 0;
      }
      else {
        while (0 < this.scroll.y &&
          this.scroll.y > this.lines.length - this.gridBounds.height) {
          --this.scroll.y;
        }
      }
    }

    refreshTokens() {
      this.tokens = this.tokenizer.tokenize(this.value);
    }

    fixCursor() {
      var moved = this.frontCursor.fixCursor(this.lines) ||
        this.backCursor.fixCursor(this.lines);
      if (moved) {
        this.render();
      }
    }

    setCursorXY(cursor, x, y) {
      x = Math.round(x);
      y = Math.round(y);
      this._pointer.set(x, y);
      this.pixel2cell(this._pointer, this.scroll, this.gridBounds);
      var gx = this._pointer.x - this.scroll.x,
        gy = this._pointer.y - this.scroll.y,
        onBottom = gy >= this.gridBounds.height,
        onLeft = gx < 0,
        onRight = this._pointer.x >= this.gridBounds.width;
      if (!this._scrolling && !onBottom && !onLeft && !onRight) {
        cursor.setXY(this._pointer.x, this._pointer.y, this.lines);
        this.backCursor.copy(cursor);
      }
      else if (this._scrolling || onRight && !onBottom) {
        this._scrolling = true;
        var scrollHeight = this.lines.length - this.gridBounds.height;
        if (gy >= 0 && scrollHeight >= 0) {
          var sy = gy * scrollHeight / this.gridBounds.height;
          this.scroll.y = Math.floor(sy);
        }
      }
      else if (onBottom && !onLeft) {
        var maxWidth = 0;
        for (var dy = 0; dy < this.lines.length; ++dy) {
          maxWidth = Math.max(maxWidth, this.lines[dy].length);
        }
        var scrollWidth = maxWidth - this.gridBounds.width;
        if (gx >= 0 && scrollWidth >= 0) {
          var sx = gx * scrollWidth / this.gridBounds.width;
          this.scroll.x = Math.floor(sx);
        }
      }
      else if (onLeft && !onBottom) {
        // clicked in number-line gutter
      }
      else {
        // clicked in the lower-left corner
      }
      this._lastPointer.copy(this._pointer);
      this.render();
    }

    mouseButtonDown(evt) {
      if (evt.button === 0) {
        this.startDOMPointer(evt);
        evt.preventDefault();
      }
    }

    mouseMove(evt) {
      if (this.focused) {
        this.moveDOMPointer(evt);
      }
    }

    mouseButtonUp(evt) {
      if (this.focused && evt.button === 0) {
        this.endPointer();
      }
    }

    touchStart(evt) {
      if (this.focused && evt.touches.length > 0 && !this._dragging) {
        var t = evt.touches[0];
        this.startDOMPointer(t);
        this._currentTouchID = t.identifier;
      }
    }

    touchMove(evt) {
      for (var i = 0; i < evt.changedTouches.length && this._dragging; ++i) {
        var t = evt.changedTouches[i];
        if (t.identifier === this._currentTouchID) {
          this.moveDOMPointer(t);
          break;
        }
      }
    }

    touchEnd(evt) {
      for (var i = 0; i < evt.changedTouches.length && this._dragging; ++i) {
        var t = evt.changedTouches[i];
        if (t.identifier === this._currentTouchID) {
          this.endPointer();
        }
      }
    }

    setGutter() {
      if (this.showLineNumbers) {
        this._topLeftGutter.width = 1;
      }
      else {
        this._topLeftGutter.width = 0;
      }

      if (!this.showScrollBars) {
        this._bottomRightGutter.set(0, 0);
      }
      else if (this.wordWrap) {
        this._bottomRightGutter.set(this._VSCROLL_WIDTH, 0);
      }
      else {
        this._bottomRightGutter.set(this._VSCROLL_WIDTH, 1);
      }
    }

    refreshGridBounds() {
      this._lineCountWidth = 0;
      if (this.showLineNumbers) {
        this._lineCountWidth = Math.max(1, Math.ceil(Math.log(this._history[this._historyFrame].length) / Math.LN10));
      }

      var x = Math.floor(this._topLeftGutter.width + this._lineCountWidth + this.padding / this.character.width),
        y = Math.floor(this.padding / this.character.height),
        w = Math.floor((this.imageWidth - 2 * this.padding) / this.character.width) - x - this._bottomRightGutter.width,
        h = Math.floor((this.imageHeight - 2 * this.padding) / this.character.height) - y - this._bottomRightGutter.height;
      this.gridBounds.set(x, y, w, h);
    }

    performLayout() {
      
      // group the tokens into rows
      this._tokenRows = [[]];
      this._tokenHashes = [""];
      this.lines = [""];
      var currentRowWidth = 0;
      var tokenQueue = this.tokens.slice();
      for (var i = 0; i < tokenQueue.length; ++i) {
        var t = tokenQueue[i].clone();
        var widthLeft = this.gridBounds.width - currentRowWidth;
        var wrap = this.wordWrap && t.type !== "newlines" && t.value.length > widthLeft;
        var breakLine = t.type === "newlines" || wrap;
        if (wrap) {
          var split = t.value.length > this.gridBounds.width ? widthLeft : 0;
          tokenQueue.splice(i + 1, 0, t.splitAt(split));
        }

        if (t.value.length > 0) {
          this._tokenRows[this._tokenRows.length - 1].push(t);
          this._tokenHashes[this._tokenHashes.length - 1] += JSON.stringify(t);
          this.lines[this.lines.length - 1] += t.value;
          currentRowWidth += t.value.length;
        }

        if (breakLine) {
          this._tokenRows.push([]);
          this._tokenHashes.push("");
          this.lines.push("");
          currentRowWidth = 0;
        }
      }
    }

    minDelta(v, minV, maxV) {
      var dvMinV = v - minV,
        dvMaxV = v - maxV + 5,
        dv = 0;
      if (dvMinV < 0 || dvMaxV >= 0) {
        // compare the absolute values, so we get the smallest change
        // regardless of direction.
        dv = Math.abs(dvMinV) < Math.abs(dvMaxV) ? dvMinV : dvMaxV;
      }

      return dv;
    }

    fillRect(gfx, fill, x, y, w, h) {
      gfx.fillStyle = fill;
      gfx.fillRect(
        x * this.character.width,
        y * this.character.height,
        w * this.character.width + 1,
        h * this.character.height + 1);
    }

    strokeRect(gfx, stroke, x, y, w, h) {
      gfx.strokeStyle = stroke;
      gfx.strokeRect(
        x * this.character.width,
        y * this.character.height,
        w * this.character.width + 1,
        h * this.character.height + 1);
    }

    renderCanvasBackground() {
      var minCursor = Primrose.Text.Cursor.min(this.frontCursor, this.backCursor),
        maxCursor = Primrose.Text.Cursor.max(this.frontCursor, this.backCursor),
        tokenFront = new Primrose.Text.Cursor(),
        tokenBack = new Primrose.Text.Cursor(),
        clearFunc = this.theme.regular.backColor ? "fillRect" : "clearRect";

      if (this.theme.regular.backColor) {
        this._bgfx.fillStyle = this.theme.regular.backColor;
      }

      this._bgfx[clearFunc](0, 0, this.imageWidth, this.imageHeight);
      this._bgfx.save();
      this._bgfx.translate(
        (this.gridBounds.x - this.scroll.x) * this.character.width + this.padding,
        -this.scroll.y * this.character.height + this.padding);


      // draw the current row highlighter
      if (this.focused) {
        this.fillRect(this._bgfx, this.theme.regular.currentRowBackColor ||
          Primrose.Text.Themes.Default.regular.currentRowBackColor,
          0, minCursor.y,
          this.gridBounds.width,
          maxCursor.y - minCursor.y + 1);
      }

      for (var y = 0; y < this._tokenRows.length; ++y) {
        // draw the tokens on this row
        var row = this._tokenRows[y];

        for (var i = 0; i < row.length; ++i) {
          var t = row[i];
          tokenBack.x += t.value.length;
          tokenBack.i += t.value.length;

          // skip drawing tokens that aren't in view
          if (this.scroll.y <= y && y < this.scroll.y + this.gridBounds.height &&
            this.scroll.x <= tokenBack.x && tokenFront.x < this.scroll.x +
            this.gridBounds.width) {
            // draw the selection box
            var inSelection = minCursor.i <= tokenBack.i && tokenFront.i <
              maxCursor.i;
            if (inSelection) {
              var selectionFront = Primrose.Text.Cursor.max(minCursor,
                tokenFront);
              var selectionBack = Primrose.Text.Cursor.min(maxCursor, tokenBack);
              var cw = selectionBack.i - selectionFront.i;
              this.fillRect(this._bgfx, this.theme.regular.selectedBackColor ||
                Primrose.Text.Themes.Default.regular.selectedBackColor,
                selectionFront.x, selectionFront.y,
                cw, 1);
            }
          }

          tokenFront.copy(tokenBack);
        }

        tokenFront.x = 0;
        ++tokenFront.y;
        tokenBack.copy(tokenFront);
      }

      // draw the cursor caret
      if (this.focused) {
        var cc = this.theme.cursorColor || "black";
        var w = 1 / this.character.width;
        this.fillRect(this._bgfx, cc, minCursor.x, minCursor.y, w, 1);
        this.fillRect(this._bgfx, cc, maxCursor.x, maxCursor.y, w, 1);
      }
      this._bgfx.restore();
    }

    renderCanvasForeground() {
      var tokenFront = new Primrose.Text.Cursor(),
        tokenBack = new Primrose.Text.Cursor(),
        lineOffsetY = Math.ceil(this.character.height * 0.2),
        i;

      this._fgfx.clearRect(0, 0, this.imageWidth, this.imageHeight);
      this._fgfx.save();
      this._fgfx.translate((this.gridBounds.x - this.scroll.x) * this.character.width + this.padding, this.padding);
      for (var y = 0; y < this._tokenRows.length; ++y) {
        // draw the tokens on this row
        var line = this.lines[y] + this.padding,
          row = this._tokenRows[y],
          drawn = false,
          textY = (y - 0.2 - this.scroll.y) * this.character.height,
          imageY = textY + lineOffsetY;

        for (i = 0; i < row.length; ++i) {
          var t = row[i];
          tokenBack.x += t.value.length;
          tokenBack.i += t.value.length;

          // skip drawing tokens that aren't in view
          if (this.scroll.y <= y && y < this.scroll.y + this.gridBounds.height &&
            this.scroll.x <= tokenBack.x && tokenFront.x < this.scroll.x +
            this.gridBounds.width) {

            // draw the text
            if (this._rowCache[line] !== undefined) {
              if (i === 0) {
                this._fgfx.putImageData(this._rowCache[line], this.padding, imageY + this.padding);
              }
            }
            else {
              var style = this.theme[t.type] || {};
              var font = (style.fontWeight || this.theme.regular.fontWeight || "") +
                " " + (style.fontStyle || this.theme.regular.fontStyle || "") +
                " " + this.character.height + "px " + this.theme.fontFamily;
              this._fgfx.font = font.trim();
              this._fgfx.fillStyle = style.foreColor || this.theme.regular.foreColor;
              this.drawText(
                this._fgfx,
                t.value,
                tokenFront.x * this.character.width,
                textY);
              drawn = true;
            }
          }

          tokenFront.copy(tokenBack);
        }

        tokenFront.x = 0;
        ++tokenFront.y;
        tokenBack.copy(tokenFront);
        if (drawn && this._rowCache[line] === undefined) {
          this._rowCache[line] = this._fgfx.getImageData(
            this.padding,
            imageY + this.padding,
            this.imageWidth - 2 * this.padding,
            this.character.height);
        }
      }
      this._fgfx.restore();
    }

    drawText(ctx, txt, x, y) {
      ctx.fillText(txt, x, y);
    }

    renderCanvasTrim() {
      var tokenFront = new Primrose.Text.Cursor(),
        tokenBack = new Primrose.Text.Cursor(),
        maxLineWidth = 0,
        i;

      this._tgfx.clearRect(0, 0, this.imageWidth, this.imageHeight);
      this._tgfx.save();
      this._tgfx.translate(this.padding, this.padding);
      this._tgfx.save();
      this._tgfx.lineWidth = 2;
      this._tgfx.translate(0, -this.scroll.y * this.character.height);
      for (var y = 0, lastLine = -1; y < this._tokenRows.length; ++y) {
        var row = this._tokenRows[y];

        for (i = 0; i < row.length; ++i) {
          var t = row[i];
          tokenBack.x += t.value.length;
          tokenBack.i += t.value.length;
          tokenFront.copy(tokenBack);
        }

        maxLineWidth = Math.max(maxLineWidth, tokenBack.x);
        tokenFront.x = 0;
        ++tokenFront.y;
        tokenBack.copy(tokenFront);

        if (this.showLineNumbers && this.scroll.y <= y && y < this.scroll.y + this.gridBounds.height) {
          // draw the tokens on this row
          // be able to draw brand-new rows that don't have any tokens yet
          var currentLine = row.length > 0 ? row[0].line : lastLine + 1;
          // draw the left gutter
          var lineNumber = currentLine.toString();
          while (lineNumber.length < this._lineCountWidth) {
            lineNumber = " " + lineNumber;
          }
          this.fillRect(this._tgfx,
            this.theme.regular.selectedBackColor ||
            Primrose.Text.Themes.Default.regular.selectedBackColor,
            0, y,
            this.gridBounds.x, 1);
          this._tgfx.font = "bold " + this.character.height + "px " +
            this.theme.fontFamily;

          if (currentLine > lastLine) {
            this._tgfx.fillStyle = this.theme.regular.foreColor;
            this._tgfx.fillText(
              lineNumber,
              0, (y - 0.2) * this.character.height);
          }
          lastLine = currentLine;
        }
      }

      this._tgfx.restore();

      if (this.showLineNumbers) {
        this.strokeRect(this._tgfx,
          this.theme.regular.foreColor ||
          Primrose.Text.Themes.Default.regular.foreColor,
          0, 0,
          this.gridBounds.x, this.gridBounds.height);
      }

      // draw the scrollbars
      if (this.showScrollBars) {
        var drawWidth = this.gridBounds.width * this.character.width - this.padding,
          drawHeight = this.gridBounds.height * this.character.height,
          scrollX = (this.scroll.x * drawWidth) / maxLineWidth + this.gridBounds.x * this.character.width,
          scrollY = (this.scroll.y * drawHeight) / this._tokenRows.length;

        this._tgfx.fillStyle = this.theme.regular.selectedBackColor ||
          Primrose.Text.Themes.Default.regular.selectedBackColor;
        // horizontal
        var bw;
        if (!this.wordWrap && maxLineWidth > this.gridBounds.width) {
          var scrollBarWidth = drawWidth * (this.gridBounds.width / maxLineWidth),
            by = this.gridBounds.height * this.character.height;
          bw = Math.max(this.character.width, scrollBarWidth);
          this._tgfx.fillRect(scrollX, by, bw, this.character.height);
          this._tgfx.strokeRect(scrollX, by, bw, this.character.height);
        }

        //vertical
        if (this._tokenRows.length > this.gridBounds.height) {
          var scrollBarHeight = drawHeight * (this.gridBounds.height / this._tokenRows.length),
            bx = this.image - this._VSCROLL_WIDTH * this.character.width - 2 * this.padding,
            bh = Math.max(this.character.height, scrollBarHeight);
          bw = this._VSCROLL_WIDTH * this.character.width;
          this._tgfx.fillRect(bx, scrollY, bw, bh);
          this._tgfx.strokeRect(bx, scrollY, bw, bh);
        }
      }

      this._tgfx.lineWidth = 2;
      this._tgfx.restore();
      this._tgfx.strokeRect(1, 1, this.imageWidth - 2, this.imageHeight - 2);
      if (!this.focused) {
        this._tgfx.fillStyle = this.theme.regular.unfocused || Primrose.Text.Themes.Default.regular.unfocused;
        this._tgfx.fillRect(0, 0, this.imageWidth, this.imageHeight);
      }
    }

    render() {
      if (this.tokens && this.theme) {
        this.refreshGridBounds();
        var boundsChanged = this.gridBounds.toString() !== this._lastGridBounds,
          textChanged = this._lastText !== this.value,
          characterWidthChanged = this.character.width !== this._lastCharacterWidth,
          characterHeightChanged = this.character.height !== this._lastCharacterHeight,
          paddingChanged = this.padding !== this._lastPadding,
          layoutChanged = this.resized || boundsChanged || textChanged || characterWidthChanged || characterHeightChanged || paddingChanged,
          cursorChanged = this.frontCursor.i !== this._lastFrontCursorI || this._lastBackCursorI !== this.backCursor.i,
          scrollChanged = this.scroll.x !== this._lastScrollX || this.scroll.y !== this._lastScrollY,
          fontChanged = this.context.font !== this._lastFont,
          focusChanged = this.focused !== this._lastFocused,
          foregroundChanged = layoutChanged || focusChanged || fontChanged || scrollChanged,
          backgroundChanged = foregroundChanged || focusChanged || cursorChanged;

        if (layoutChanged) {
          this.performLayout(this.gridBounds);
          this._rowCache = {};
        }

        if (foregroundChanged || backgroundChanged) {
          this.renderCanvasBackground();

          if (foregroundChanged || focusChanged) {
            if (foregroundChanged) {
              this.renderCanvasForeground();
            }
            this.renderCanvasTrim();
          }

          this.context.clearRect(0, 0, this.imageWidth, this.imageHeight);
          this.context.drawImage(this._bgCanvas, 0, 0);
          this.context.drawImage(this._fgCanvas, 0, 0);
          this.context.drawImage(this._trimCanvas, 0, 0);
          if (this.parent) {
            this.parent.invalidate(this.bounds);
          }
        }

        this._lastGridBounds = this.gridBounds.toString();
        this._lastText = this.value;
        this._lastCharacterWidth = this.character.width;
        this._lastCharacterHeight = this.character.height;
        this._lastWidth = this.imageWidth;
        this._lastHeight = this.imageHeight;
        this._lastPadding = this.padding;
        this._lastFrontCursorI = this.frontCursor.i;
        this._lastBackCursorI = this.backCursor.i;
        this._lastFocused = this.focused;
        this._lastFont = this.context.font;
        this._lastScrollX = this.scroll.x;
        this._lastScrollY = this.scroll.y;
      }
    }
  }

  return TextBox;
})();

pliny.issue("Primrose.Text.Controls.TextBox", {
  name: "document TextBox",
  type: "open",
  description: "Finish writing the documentation for the [Primrose.Text.Controls.TextBox](#Primrose_Text_Controls_TextBox)\n\
class in the controls/ directory."
});

pliny.issue("Primrose.Text.Controls.TextBox", {
  name: "TextBox does not render blank lines",
  type: "open",
  description: "If a line contains only a newline character, the line doesn't get\n\
rendered at all. The next line gets rendered instead, with the line number it *would*\n\
have had, had the blank line been rendered. Adding whitespace to the line causes\n\
it to render. This seems to only happen for text that is loaded into the textbox,\n\
not text that is entered by the keyboard."
});

pliny.issue("Primrose.Text.Controls.TextBox", {
  name: "TextBox should re-render only on updates, not require an animation loop.",
  type: "open",
  description: "Currently, the TextBox knows quite a bit about when it needs to\n\
update, but it doesn't use this information to actually kick off a render. It first\n\
requires us to ask it to render, and then it decides if it's time to render. Instead,\n\
the invalidation that causes it to decide to render should just kick off a render."
});