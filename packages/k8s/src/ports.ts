import { brand } from "@konfig.ts/core";

/**
 * Branded port name — a string carrying the literal `N` in its type.
 * Constructed by `Port.make({ name, containerPort })` and `Port.ref(name)`.
 * The brand lets probes and Service `targetPort` constrain their
 * `port` field to a member of the container's declared port-name union
 * rather than `string`.
 */
declare const PortNameBrand: unique symbol;
export type PortName<N extends string> = string & {
	readonly [PortNameBrand]: N;
};

const _portName = <const N extends string>(name: N): PortName<N> => brand<PortName<N>>(name);

export type ContainerProtocol = "TCP" | "UDP" | "SCTP";

export interface ContainerPort<N extends string = string> {
	readonly containerPort: number;
	readonly name?: PortName<N>;
	readonly protocol?: ContainerProtocol;
	readonly hostPort?: number;
	readonly hostIP?: string;
}

export interface PortInput<N extends string> {
	readonly name: N;
	readonly containerPort: number;
	readonly protocol?: ContainerProtocol;
	readonly hostPort?: number;
	readonly hostIP?: string;
}

/**
 * `Port` value namespace.
 *
 *   ports: [Port.make({ name: "http", containerPort: 8080 })],
 *   readinessProbe: { httpGet: { port: Port.ref("http") } },
 *
 * - `Port.make(input)` constructs a named container port; the literal
 *   `name` is captured in the returned `ContainerPort<N>` brand so
 *   `defineContainer` can infer the port-name union and constrain
 *   cross-references (probes, Service.targetPort).
 * - `Port.ref(name)` returns the brand alone, for probe targets and
 *   `targetPort` references that need to name an existing declared port.
 */
export const Port = {
	make: <const N extends string>(input: PortInput<N>): ContainerPort<N> => ({
		containerPort: input.containerPort,
		name: _portName(input.name),
		protocol: input.protocol,
		hostPort: input.hostPort,
		hostIP: input.hostIP,
	}),
	ref: <const N extends string>(name: N): PortName<N> => _portName(name),
};

export interface HttpHeader {
	readonly name: string;
	readonly value: string;
}

export interface HttpGetAction<Ports extends string> {
	readonly path?: string;
	readonly port: number | PortName<Ports>;
	readonly host?: string;
	readonly scheme?: "HTTP" | "HTTPS";
	readonly httpHeaders?: ReadonlyArray<HttpHeader>;
}

export interface TcpSocketAction<Ports extends string> {
	readonly port: number | PortName<Ports>;
	readonly host?: string;
}

export interface GrpcAction<Ports extends string> {
	readonly port: number | PortName<Ports>;
	readonly service?: string;
}

export interface ExecAction {
	readonly command: ReadonlyArray<string>;
}

/**
 * Probe target — `port` references on httpGet/tcpSocket/grpc are
 * constrained to `Ports`, the union of names declared on the owning
 * container. A bare number is always accepted; only the named variant
 * is checked.
 */
export interface ProbeTarget<Ports extends string> {
	readonly httpGet?: HttpGetAction<Ports>;
	readonly tcpSocket?: TcpSocketAction<Ports>;
	readonly grpc?: GrpcAction<Ports>;
	readonly exec?: ExecAction;
	readonly initialDelaySeconds?: number;
	readonly periodSeconds?: number;
	readonly timeoutSeconds?: number;
	readonly successThreshold?: number;
	readonly failureThreshold?: number;
	readonly terminationGracePeriodSeconds?: number;
}

export type NamesOf<P extends ReadonlyArray<unknown>> = {
	readonly [K in keyof P]: P[K] extends ContainerPort<infer N> ? N : never;
}[number];

/**
 * Service-port input bound to a container's port-name union. `targetPort`
 * accepts a bare number or a `PortName<Ports>`. The `Ports` parameter is
 * locked by `forContainer` on `Service.fromContainer`; use `Port.ref(name)`
 * to reference declared ports.
 */
export interface ServicePortSpec<Ports extends string> {
	readonly name?: string;
	readonly port: number;
	readonly targetPort: number | PortName<Ports>;
	readonly protocol?: ContainerProtocol;
	readonly appProtocol?: string;
	readonly nodePort?: number;
}
