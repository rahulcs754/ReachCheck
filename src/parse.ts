import { parse } from "@babel/parser";

/** A local name bound by an import. `imported` is "default", "*" (namespace or CommonJS object) or the export name. */
export interface Binding {
  local: string;
  imported: string;
}

export interface ImportRecord {
  spec: string;
  kind: "static" | "dynamic" | "require" | "reexport";
  typeOnly: boolean;
  line: number;
  bindings: Binding[];
}

/** A call like `foo()` -> ["foo"], `_.template()` -> ["_", "template"]. */
export interface CallSite {
  callee: string[];
  line: number;
}

export interface ParsedFile {
  path: string;
  imports: ImportRecord[];
  calls: CallSite[];
  directive?: "client" | "server";
  error?: string;
}

const PLUGINS: any[] = ["typescript", "jsx", "decorators-legacy", "importAttributes", "explicitResourceManagement"];

function parseAst(text: string, path: string): any {
  // .ts files can't contain JSX, and `<T>x` casts break the jsx plugin, so pick plugins by extension.
  const plugins = /\.(c|m)?ts$/.test(path) ? PLUGINS.filter((p) => p !== "jsx") : PLUGINS;
  return parse(text, { sourceType: "unambiguous", plugins, errorRecovery: true, allowReturnOutsideFunction: true } as any);
}

const strOf = (node: any): string | undefined => {
  if (!node) return undefined;
  if (node.type === "StringLiteral") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0]?.value.cooked ?? undefined;
  return undefined;
};

const nameOf = (node: any): string | undefined =>
  node?.type === "Identifier" ? node.name : node?.type === "StringLiteral" ? node.value : undefined;

/** `require("x")`, `await import("x")`, `require("x").y` -> the specifier, or undefined. */
function requiredSpec(node: any): { spec: string; kind: "require" | "dynamic"; member?: string } | undefined {
  let n = node;
  if (n?.type === "AwaitExpression") n = n.argument;
  let member: string | undefined;
  if ((n?.type === "MemberExpression" || n?.type === "OptionalMemberExpression") && !n.computed) {
    member = nameOf(n.property);
    n = n.object;
  }
  if (n?.type === "ImportExpression") {
    // Babel 8 parses import("x") as ImportExpression
    const spec = strOf(n.source);
    return spec ? { spec, kind: "dynamic", member } : undefined;
  }
  if (n?.type !== "CallExpression") return undefined;
  const arg = strOf(n.arguments[0]);
  if (!arg) return undefined;
  if (n.callee.type === "Identifier" && n.callee.name === "require") return { spec: arg, kind: "require", member };
  if (n.callee.type === "Import") return { spec: arg, kind: "dynamic", member };
  return undefined;
}

/** Bindings from `const { a, b: c } = ...` or `const x = ...`. */
function patternBindings(id: any, member?: string): Binding[] {
  if (id?.type === "Identifier") return [{ local: id.name, imported: member ?? "*" }];
  if (id?.type === "ObjectPattern" && !member) {
    const out: Binding[] = [];
    for (const p of id.properties) {
      if (p.type !== "ObjectProperty") continue;
      const key = nameOf(p.key);
      const val = p.value?.type === "AssignmentPattern" ? p.value.left : p.value;
      if (key && val?.type === "Identifier") out.push({ local: val.name, imported: key });
    }
    return out;
  }
  return [];
}

function calleePath(node: any): string[] | undefined {
  if (node?.type === "Identifier") return [node.name];
  if (node?.type === "MemberExpression" || node?.type === "OptionalMemberExpression") {
    const obj = calleePath(node.object);
    const prop = node.computed ? strOf(node.property) : nameOf(node.property);
    return obj && prop ? [...obj, prop] : undefined;
  }
  if (node?.type === "TSNonNullExpression" || node?.type === "TSAsExpression" || node?.type === "ParenthesizedExpression") return calleePath(node.expression);
  return undefined;
}

/** Imports, calls and the "use client" / "use server" directive of one JS/TS file. */
export function parseFile(path: string, text: string): ParsedFile {
  const out: ParsedFile = { path, imports: [], calls: [] };
  let ast: any;
  try {
    ast = parseAst(text, path);
  } catch (e) {
    out.error = (e as Error).message;
    return out;
  }
  for (const d of ast.program.directives ?? []) {
    if (d.value?.value === "use client") out.directive = "client";
    else if (d.value?.value === "use server") out.directive = "server";
  }
  const seenDynamic = new Set<any>();

  const visit = (node: any): void => {
    if (!node || typeof node.type !== "string") return;
    const line = node.loc?.start.line ?? 0;
    switch (node.type) {
      case "ImportDeclaration": {
        const typeOnly = node.importKind === "type" || (node.specifiers.length > 0 && node.specifiers.every((s: any) => s.importKind === "type"));
        const bindings: Binding[] = node.specifiers
          .filter((s: any) => s.importKind !== "type")
          .map((s: any) =>
            s.type === "ImportDefaultSpecifier"
              ? { local: s.local.name, imported: "default" }
              : s.type === "ImportNamespaceSpecifier"
                ? { local: s.local.name, imported: "*" }
                : { local: s.local.name, imported: nameOf(s.imported) ?? s.local.name },
          );
        out.imports.push({ spec: node.source.value, kind: "static", typeOnly, line, bindings });
        return;
      }
      case "ExportAllDeclaration":
      case "ExportNamedDeclaration":
        if (node.source) {
          const typeOnly = node.exportKind === "type";
          const bindings: Binding[] =
            node.type === "ExportAllDeclaration" ? [] : (node.specifiers ?? []).map((s: any) => ({ local: "", imported: nameOf(s.local) ?? "*" }));
          out.imports.push({ spec: node.source.value, kind: "reexport", typeOnly, line, bindings });
          return;
        }
        break;
      case "TSImportEqualsDeclaration":
        if (node.moduleReference?.type === "TSExternalModuleReference") {
          out.imports.push({ spec: node.moduleReference.expression.value, kind: "require", typeOnly: node.importKind === "type", line, bindings: [{ local: node.id.name, imported: "*" }] });
        }
        return;
      case "VariableDeclarator": {
        const req = requiredSpec(node.init);
        if (req) {
          out.imports.push({ spec: req.spec, kind: req.kind, typeOnly: false, line, bindings: patternBindings(node.id, req.member) });
          seenDynamic.add(node.init.type === "AwaitExpression" ? node.init.argument : node.init);
          // still walk the init for nested calls of require(...)(...)
          visit(node.id);
          return;
        }
        break;
      }
      case "CallExpression":
      case "OptionalCallExpression":
      case "NewExpression": {
        const req = node.type === "CallExpression" ? requiredSpec(node) : undefined;
        if (req && !seenDynamic.has(node)) {
          out.imports.push({ spec: req.spec, kind: req.kind, typeOnly: false, line, bindings: [] });
        }
        const callee = calleePath(node.callee);
        if (callee) out.calls.push({ callee, line });
        break;
      }
      case "ImportExpression": {
        const req = requiredSpec(node);
        if (req && !seenDynamic.has(node)) out.imports.push({ spec: req.spec, kind: "dynamic", typeOnly: false, line, bindings: [] });
        break;
      }
      case "TaggedTemplateExpression": {
        const callee = calleePath(node.tag);
        if (callee) out.calls.push({ callee, line });
        break;
      }
      case "JSXOpeningElement": {
        // <Markdown /> renders the component: count it as a call
        const n = node.name;
        const callee = n.type === "JSXIdentifier" ? [n.name] : n.type === "JSXMemberExpression" ? jsxMember(n) : undefined;
        if (callee) out.calls.push({ callee, line });
        break;
      }
    }
    for (const key in node) {
      if (key === "loc" || key === "start" || key === "end" || key === "leadingComments" || key === "trailingComments" || key === "extra") continue;
      const child = node[key];
      if (Array.isArray(child)) for (const c of child) visit(c);
      else if (child && typeof child === "object") visit(child);
    }
  };
  visit(ast.program);
  return out;
}

function jsxMember(n: any): string[] | undefined {
  if (n.type === "JSXIdentifier") return [n.name];
  if (n.type === "JSXMemberExpression") {
    const obj = jsxMember(n.object);
    return obj ? [...obj, n.property.name] : undefined;
  }
  return undefined;
}

/** "lodash/template" -> "lodash", "@scope/pkg/sub" -> "@scope/pkg". Relative, absolute, node: and # imports -> undefined. */
export function packageOf(spec: string): string | undefined {
  if (!spec || spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("node:") || spec.startsWith("#") || spec.includes(":")) return undefined;
  const parts = spec.split("/");
  return spec.startsWith("@") ? (parts.length > 1 ? `${parts[0]}/${parts[1]}` : undefined) : parts[0];
}
