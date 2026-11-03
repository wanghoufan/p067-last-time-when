export type ElChild = Node | string | number | null | undefined | false;

export type ElHandlers = {
  [E in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[E]) => void;
};

export interface ElProps {
  className?: string;
  text?: string | number;
  attrs?: Record<string, string | number | boolean | null | undefined>;
  dataset?: Record<string, string>;
  on?: ElHandlers;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps = {},
  children: ElChild[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  if (props.className) node.className = props.className;
  if (props.text !== undefined) node.textContent = String(props.text);

  if (props.attrs) {
    for (const [name, value] of Object.entries(props.attrs)) {
      if (value === null || value === undefined || value === false) continue;
      node.setAttribute(name, value === true ? '' : String(value));
    }
  }

  if (props.dataset) {
    for (const [name, value] of Object.entries(props.dataset)) {
      node.dataset[name] = value;
    }
  }

  if (props.on) {
    for (const [type, handler] of Object.entries(props.on)) {
      node.addEventListener(type, handler as EventListener);
    }
  }

  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }

  return node;
}