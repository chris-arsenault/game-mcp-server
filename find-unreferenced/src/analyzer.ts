import fs from "node:fs";
import path from "node:path";

import {
    Node,
    Project,
    SourceFile,
    ts,
    FunctionDeclaration,
    VariableDeclaration,
    ReferenceFindableNode
} from "ts-morph";

export interface AnalyzerOptions {
    sourceRoot: string;
    limit?: number;
}

export interface FunctionInfo {
    name: string;
    kind: "function" | "arrow";
    file: string;
    line: number;
    column: number;
}

export interface AnalyzerResult {
    sourceRoot: string;
    totalFilesScanned: number;
    totalFunctionsAnalyzed: number;
    totalUnreferenced: number;
    unreferencedFunctions: FunctionInfo[];
    truncated: boolean;
}

interface FunctionNode {
    node: ReferenceFindableNode & Node;
    name: string;
    kind: "function" | "arrow";
}

function findNearestTsConfig(startDir: string): string | undefined {
    let current = path.resolve(startDir);
    while (true) {
        const candidate = path.join(current, "tsconfig.json");
        if (fs.existsSync(candidate)) {
            return candidate;
        }

        const parent = path.dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }

    return undefined;
}

function createProject(sourceRoot: string): Project {
    const tsconfigPath = findNearestTsConfig(sourceRoot);
    if (tsconfigPath) {
        return new Project({
            tsConfigFilePath: tsconfigPath
        });
    }

    return new Project({
        compilerOptions: {
            allowJs: false,
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.NodeNext,
            moduleResolution: ts.ModuleResolutionKind.NodeNext,
            skipLibCheck: true,
            strict: true
        },
        useInMemoryFileSystem: false
    });
}

function collectFunctionNodes(sourceFile: SourceFile): FunctionNode[] {
    const functions: FunctionNode[] = [];

    sourceFile.getFunctions().forEach((fn: FunctionDeclaration) => {
        if (!fn.getBody()) {
            return;
        }
        const name = fn.getName();
        if (!name) {
            return;
        }

        functions.push({
            node: fn,
            name,
            kind: "function"
        });
    });

    sourceFile.getVariableDeclarations().forEach((decl: VariableDeclaration) => {
        const initializer = decl.getInitializer();
        if (!initializer) {
            return;
        }

        if (!Node.isArrowFunction(initializer) && !Node.isFunctionExpression(initializer)) {
            return;
        }

        const name = decl.getName();
        if (!name) {
            return;
        }

        functions.push({
            node: decl,
            name,
            kind: "arrow"
        });
    });

    return functions;
}

function getLocationInfo(sourceFile: SourceFile, node: ReferenceFindableNode & Node) {
    const nameNode = "getNameNode" in node ? (node as unknown as { getNameNode: () => Node | undefined }).getNameNode?.() : undefined;
    const targetNode = nameNode ?? node;
    const position = sourceFile.getLineAndColumnAtPos(targetNode.getStart());
    return {
        line: position.line,
        column: position.column
    };
}

export function analyzeUnreferencedFunctions(options: AnalyzerOptions): AnalyzerResult {
    const sourceRoot = path.resolve(options.sourceRoot);
    const project = createProject(sourceRoot);

    const globRoot = sourceRoot.replace(/\\/g, "/");

    project.addSourceFilesAtPaths([
        `${globRoot}/**/*.ts`,
        `${globRoot}/**/*.tsx`,
        `${globRoot}/**/*.mts`,
        `${globRoot}/**/*.cts`,
        `!${globRoot}/**/node_modules/**`,
        `!${globRoot}/**/*.d.ts`
    ]);

    project.resolveSourceFileDependencies();

    const normalizedRootWithSep = sourceRoot.endsWith(path.sep) ? sourceRoot : `${sourceRoot}${path.sep}`;
    const sourceFiles = project
        .getSourceFiles()
        .filter((file) => !file.isDeclarationFile())
        .filter((file) => {
            const filePath = path.resolve(file.getFilePath());
            return filePath === sourceRoot || filePath.startsWith(normalizedRootWithSep);
        });
    const allFunctionNodes: FunctionNode[] = [];

    sourceFiles.forEach((file) => {
        collectFunctionNodes(file).forEach((fn) => {
            allFunctionNodes.push(fn);
        });
    });

    const unreferenced: FunctionInfo[] = [];

    allFunctionNodes.forEach(({ node, kind, name }) => {
        const references = node.findReferences();
        let referenceCount = 0;

        references.forEach((ref) => {
            ref.getReferences().forEach((refNode) => {
                if (!refNode.isDefinition()) {
                    referenceCount += 1;
                }
            });
        });

        if (referenceCount === 0) {
            const sourceFile = node.getSourceFile();
            const location = getLocationInfo(sourceFile, node);
            const filePath = path.relative(process.cwd(), sourceFile.getFilePath()) || sourceFile.getFilePath();

            unreferenced.push({
                name,
                kind,
                file: filePath,
                line: location.line,
                column: location.column
            });
        }
    });

    unreferenced.sort((a, b) => {
        if (a.file === b.file) {
            return a.line - b.line;
        }
        return a.file.localeCompare(b.file);
    });

    const limit = options.limit ?? null;
    const limitedResults = limit != null ? unreferenced.slice(0, limit) : unreferenced;
    const truncated = limit != null && unreferenced.length > limit;

    return {
        sourceRoot,
        totalFilesScanned: sourceFiles.length,
        totalFunctionsAnalyzed: allFunctionNodes.length,
        totalUnreferenced: unreferenced.length,
        unreferencedFunctions: limitedResults,
        truncated
    };
}
