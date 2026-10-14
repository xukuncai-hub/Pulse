using System.IO.Ports;
using NModbus.IO;

namespace S7Scada.Services;

/// <summary>
/// 把 System.IO.Ports.SerialPort 适配成 NModbus 的 IStreamResource（桥接模式），
/// 让 NModbus 的 Modbus RTU 收发逻辑可以直接跑在串口上（RS485 / RS232 通用）。
/// RTU 的 CRC 校验与帧边界（帧间隔）由 NModbus 内部处理。
/// </summary>
public class SerialStreamAdapter : IStreamResource
{
    private readonly SerialPort _port;

    public SerialStreamAdapter(SerialPort port) => _port = port;

    public int InfiniteTimeout => SerialPort.InfiniteTimeout;

    public int ReadTimeout
    {
        get => _port.ReadTimeout;
        set => _port.ReadTimeout = value;
    }

    public int WriteTimeout
    {
        get => _port.WriteTimeout;
        set => _port.WriteTimeout = value;
    }

    public void DiscardInBuffer() => _port.DiscardInBuffer();

    public int Read(byte[] buffer, int offset, int count) => _port.Read(buffer, offset, count);

    public void Write(byte[] buffer, int offset, int count) => _port.Write(buffer, offset, count);

    public void Dispose() => _port.Dispose();
}
