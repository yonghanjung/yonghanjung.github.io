(() => {
  "use strict";
  const app = document.getElementById("app"),
    E = CountingSense;
  let recent = [],
    model,
    step,
    value,
    wrong,
    shown,
    complete;
  const node = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const button = (text, action, cls = "") => {
    const b = node("button", cls, text);
    b.type = "button";
    b.onclick = action;
    return b;
  };
  function nextProblem() {
    model = E.next(recent);
    recent.push(E.pairKey(model));
    recent = recent.slice(-20);
    step = 0;
    value = "";
    wrong = false;
    shown = false;
    complete = false;
    render();
    window.scrollTo(0, 0);
  }
  function render(focusAnswer = false) {
    app.replaceChildren(node("h1", "", "Counting Sense"), node("p", "problem", `${model.base} − ${model.take} = ?`));
    const split = node("div", "split"),
      parts = node("div", "split-parts");
    split.append(node("p", "", "Split off one hundred."));
    for (const [label, text, cls] of [
      ["Keep", model.kept, "kept"],
      ["Work on 100", `(100 − ${model.take})`, "work"],
    ]) {
      if (parts.childNodes.length) parts.append(node("span", "plus", "+"));
      const part = node("div", "part " + cls);
      part.append(node("small", "", label), node("strong", "", String(text)));
      parts.append(part);
    }
    split.append(parts);
    app.append(split);
    const card = node("section", "card");
    if (complete) {
      card.append(
        node("p", "step", "Put the parts together"),
        node("p", "success", `${model.base} − ${model.take} = ${model.total}`),
        node("p", "", `100 − ${model.take} = ${model.subtotal}. Keep ${model.kept} and add ${model.subtotal}.`)
      );
    } else {
      card.append(node("p", "step", step === 0 ? "1 of 2 · Work on 100" : "2 of 2 · Add the parts"));
      const form = node("form"),
        label = node("label", "task", step === 0 ? `100 − ${model.take} =` : `${model.kept} + ${model.subtotal} =`);
      label.htmlFor = "answer";
      const input = node("input");
      input.id = "answer";
      input.type = "text";
      input.inputMode = "numeric";
      input.pattern = "[0-9]*";
      input.autocomplete = "off";
      input.maxLength = 3;
      input.value = value;
      input.setAttribute("aria-label", step === 0 ? `100 minus ${model.take}` : `${model.kept} plus ${model.subtotal}`);
      input.oninput = () => {
        value = input.value.replace(/\D/g, "").slice(0, 3);
        input.value = value;
      };
      const check = node("button", "primary", "Check");
      check.type = "submit";
      form.append(label, input, check);
      form.onsubmit = (event) => {
        event.preventDefault();
        const result = E.gradeStep(model, step, value);
        if (!result.valid) {
          input.focus();
          return;
        }
        if (!result.correct) {
          wrong = true;
          render(true);
          return;
        }
        if (step === 0) {
          step = 1;
          value = "";
          wrong = false;
          shown = false;
        } else complete = true;
        render();
      };
      card.append(form);
      if (wrong) {
        const status = node(
          "p",
          "status wrong",
          step === 0 ? `Try again. Work on 100 − ${model.take} first.` : `Try again. Keep ${model.kept}. Add ${model.subtotal}.`
        );
        status.setAttribute("role", "status");
        card.append(status);
      }
      const actions = node("div", "actions");
      if (step === 1)
        actions.append(
          button("Previous step", () => {
            step = 0;
            value = String(model.subtotal);
            wrong = false;
            shown = false;
            render();
          })
        );
      if (wrong || shown)
        actions.append(
          button(shown ? "Hide steps" : "Show me", () => {
            shown = !shown;
            render();
          })
        );
      if (actions.childNodes.length) card.append(actions);
      if (shown) {
        const help = node("div", "help");
        help.append(
          node("p", "", step === 0 ? `Subtract ${model.take} from the one hundred.` : `The ${model.kept} stays. Add what is left from 100.`),
          node("p", "equation", step === 0 ? `100 − ${model.take} = ${model.subtotal}` : `${model.kept} + ${model.subtotal} = ${model.total}`)
        );
        card.append(help);
      }
    }
    app.append(card);
    const navigation = node("nav", "navigation");
    navigation.setAttribute("aria-label", "Practice navigation");
    navigation.append(button("Next problem →", nextProblem, "primary"));
    app.append(navigation);
    if (focusAnswer) document.getElementById("answer").focus({ preventScroll: true });
  }
  nextProblem();
})();
