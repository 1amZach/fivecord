// The handful of FiveM server natives and globals this resource uses.

type Src = number | string;

declare var source: Src;
declare var GlobalState: Record<string, unknown>;

declare function on(event: string, handler: (...args: any[]) => void): void;
declare function onNet(event: string, handler: (...args: any[]) => void): void;
declare function emit(event: string, ...args: unknown[]): void;
declare function emitNet(event: string, target: Src, ...args: unknown[]): void;
declare function setTick(handler: () => void): number;

declare function GetCurrentResourceName(): string;
declare function GetInvokingResource(): string;
declare function GetConvar(name: string, fallback: string): string;
declare function GetConvarInt(name: string, fallback: number): number;
declare function ExecuteCommand(command: string): void;
declare function RegisterCommand(name: string, handler: (src: number, args: string[], raw: string) => void, restricted: boolean): void;
declare function RegisterConsoleListener(handler: (channel: string, message: string) => void): void;
declare function CancelEvent(): void;

declare function GetPlayers(): string[];
declare function GetPlayerName(src: Src): string;
declare function GetNumPlayerIdentifiers(src: Src): number;
declare function GetPlayerIdentifier(src: Src, index: number): string;
declare function GetNumPlayerTokens(src: Src): number;
declare function GetPlayerToken(src: Src, index: number): string;
declare function GetPlayerPing(src: Src): number;
declare function GetPlayerPed(src: Src): number;
declare function GetEntityCoords(entity: number): number[];
declare function GetEntityHealth(entity: number): number;
declare function DropPlayer(src: Src, reason: string): void;
declare function IsPlayerAceAllowed(src: Src, ace: string): boolean;

declare function GetNumResources(): number;
declare function GetResourceByFindIndex(index: number): string;
declare function GetResourceState(name: string): string;
declare function GetResourceMetadata(name: string, key: string, index: number): string;
declare function StartResource(name: string): boolean;
declare function StopResource(name: string): boolean;
declare function LoadResourceFile(name: string, path: string): string | null;
declare function SaveResourceFile(name: string, path: string, data: string, length: number): boolean;
