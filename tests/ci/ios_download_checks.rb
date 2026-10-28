# Runs against the actually patched npm sources, never a model of their Ruby logic.
require 'socket'
require 'tempfile'
root = File.expand_path(ARGV.fetch(0))
require File.join(root, 'scripts/cocoapods/utils.rb')
require File.join(root, 'sdks/hermes-engine/hermes-utils.rb')
def hermes_log(*); end

file = Tempfile.new('liftcut-checksum')
file.write('tiny synthetic artifact')
file.flush
checksum = Digest::SHA1.file(file.path).hexdigest
server = TCPServer.new('127.0.0.1', 0)
worker = Thread.new do
  loop do
    client = server.accept
    path = client.gets.to_s.split[1]
    while (line = client.gets) && line != "\r\n"; end
    status = path == '/missing.sha1' ? '404 Not Found' : '200 OK'
    payload = {'/valid.sha1' => checksum, '/mismatch.sha1' => '0' * 40}.fetch(path, 'invalid checksum')
    client.write("HTTP/1.1 #{status}\r\nContent-Length: #{payload.bytesize}\r\nConnection: close\r\n\r\n#{payload}")
    client.close
  end
rescue IOError, Errno::EBADF
  # Main thread closes the synthetic server after all assertions.
end
begin
  validators = [ReactNativePodsUtils.method(:validate_tarball), method(:validate_hermes_tarball)]
  validators.each do |validate|
    {'missing' => false, 'invalid' => false, 'mismatch' => false, 'valid' => true}.each do |mode, expected|
      actual = validate.call(file.path, "http://127.0.0.1:#{server.addr[1]}/#{mode}")
      raise "Incorrect #{mode} checksum behavior" unless actual == expected
    end
  end
  puts 'Both installed Ruby validators reject missing, invalid and mismatched checksums; valid bytes pass.'
ensure
  server.close
  worker.join(3)
  file.close!
end
