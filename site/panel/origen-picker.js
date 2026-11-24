export function originPicker(input, menu, list, empty, normalize) {
  let entries = [];
  let active = -1;

  function focusOption(index) {
    list.children[active]?.setAttribute('aria-selected', 'false');
    active = index;
    const option = list.children[active];
    if (option) {
      option.setAttribute('aria-selected', 'true');
      input.setAttribute('aria-activedescendant', option.id);
      option.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function close() {
    focusOption(-1);
    menu.hidden = true;
    input.setAttribute('aria-expanded', 'false');
  }

  function choose(value) {
    input.value = value;
    input.setCustomValidity('');
    close();
  }

  function render() {
    const query = normalize(input.value);
    const terms = query.split(' ');
    const matches = entries.filter(entry => terms.every(term => entry.key.includes(term)));
    matches.sort((left, right) => Number(right.key.startsWith(query)) - Number(left.key.startsWith(query)));
    focusOption(-1);
    list.replaceChildren(...matches.map(({ value }, index) => {
      const item = document.createElement('li');
      item.id = `origen-opcion-${index}`;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', 'false');
      item.textContent = value;
      item.addEventListener('mousedown', event => event.preventDefault());
      item.addEventListener('click', () => choose(value));
      return item;
    }));
    list.scrollTop = 0;
    empty.hidden = Boolean(matches.length);
    menu.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  input.addEventListener('focus', render);
  input.addEventListener('click', () => { if (menu.hidden) render(); });
  input.addEventListener('input', () => { input.setCustomValidity(''); render(); });
  input.addEventListener('blur', close);
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !menu.hidden) {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'Enter' && active >= 0 && !menu.hidden) {
      event.preventDefault();
      choose(list.children[active].textContent);
      return;
    }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    if (menu.hidden) render();
    const last = list.children.length - 1;
    if (last < 0) return;
    const index = event.key === 'ArrowDown' ? Math.min(active + 1, last) : active <= 0 ? last : active - 1;
    focusOption(index);
  });

  return { setOptions(values) { entries = values.map(value => ({ value, key: normalize(value) })); }, close };
}
