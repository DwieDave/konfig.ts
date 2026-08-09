import { brand } from "@konfig.ts/core"

declare const PortNameBrand: unique symbol
export type PortName<N extends string> = string & {
  readonly [PortNameBrand]: N
}

const _portName = <const N extends string>(name: N): PortName<N> => brand<PortName<N>>(name)

export type ContainerProtocol = "TCP" | "UDP" | "SCTP"

export interface ContainerPort<N extends string = string> {
  readonly containerPort: number
  readonly name?: PortName<N>
  readonly protocol?: ContainerProtocol
  readonly hostPort?: number
  readonly hostIP?: string
}

export interface PortInput<N extends string> {
  readonly name: N
  readonly containerPort: number
  readonly protocol?: ContainerProtocol
  readonly hostPort?: number
  readonly hostIP?: string
}

export const Port = {
  make: <const N extends string>(input: PortInput<N>): ContainerPort<N> => ({
    containerPort: input.containerPort,
    name: _portName(input.name),
    protocol: input.protocol,
    hostPort: input.hostPort,
    hostIP: input.hostIP
  }),
  ref: <const N extends string>(name: N): PortName<N> => _portName(name)
}

export interface HttpHeader {
  readonly name: string
  readonly value: string
}

export interface HttpGetAction<Ports extends string> {
  readonly path?: string
  readonly port: number | PortName<Ports>
  readonly host?: string
  readonly scheme?: "HTTP" | "HTTPS"
  readonly httpHeaders?: ReadonlyArray<HttpHeader>
}

export interface TcpSocketAction<Ports extends string> {
  readonly port: number | PortName<Ports>
  readonly host?: string
}

export interface GrpcAction<Ports extends string> {
  readonly port: number | PortName<Ports>
  readonly service?: string
}

export interface ExecAction {
  readonly command: ReadonlyArray<string>
}

export interface ProbeTarget<Ports extends string> {
  readonly httpGet?: HttpGetAction<Ports>
  readonly tcpSocket?: TcpSocketAction<Ports>
  readonly grpc?: GrpcAction<Ports>
  readonly exec?: ExecAction
  readonly initialDelaySeconds?: number
  readonly periodSeconds?: number
  readonly timeoutSeconds?: number
  readonly successThreshold?: number
  readonly failureThreshold?: number
  readonly terminationGracePeriodSeconds?: number
}

export type NamesOf<P extends ReadonlyArray<unknown>> = {
  readonly [K in keyof P]: P[K] extends ContainerPort<infer N> ? N : never
}[number]

export interface ServicePortSpec<Ports extends string> {
  readonly name?: string
  readonly port: number
  readonly targetPort: number | PortName<Ports>
  readonly protocol?: ContainerProtocol
  readonly appProtocol?: string
  readonly nodePort?: number
}
