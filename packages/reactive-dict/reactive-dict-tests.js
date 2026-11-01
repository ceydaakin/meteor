Tinytest.add('ReactiveDict - set to undefined', function (test) {
  var dict = new ReactiveDict;
  dict.set('foo', undefined);
  test.equal(Object.keys(dict.all()), ['foo']);
  dict.setDefault('foo', 'bar');
  test.equal(dict.get('foo'), undefined);
});

Tinytest.add('ReactiveDict - initialize with data', function (test) {
  var now = new Date();
  var dict = new ReactiveDict({
    now: now
  });

  var nowFromDict = dict.get('now');
  test.equal(nowFromDict, now);

  // Test with static value here as a named dict could
  // be migrated if code reload happens while testing
  dict = new ReactiveDict('foo', {
    foo: 'bar'
  });

  nowFromDict = dict.get('foo');
  test.equal(nowFromDict, 'bar');

  dict = new ReactiveDict(undefined, {
    now: now
  });

  nowFromDict = dict.get('now');
  test.equal(nowFromDict, now);
});

Tinytest.add('ReactiveDict - setDefault', function (test) {
  var dict = new ReactiveDict;
  dict.set('A', 'blah');
  dict.set('B', undefined);
  dict.setDefault('A', 'default');
  dict.setDefault('B', 'default');
  dict.setDefault('C', 'default');
  dict.setDefault('D', undefined);
  test.equal(dict.all(), {A: 'blah', B: undefined,
                          C: 'default', D: undefined});

  dict = new ReactiveDict;
  dict.set('A', 'blah');
  dict.set('B', undefined);
  dict.setDefault({
    A: 'default',
    B: 'defualt',
    C: 'default',
    D: undefined
  });
  test.equal(dict.all(), {A: 'blah', B: undefined,
                          C: 'default', D: undefined});
});

Tinytest.add('ReactiveDict - all() works', function (test) {
  var all = {}, dict = new ReactiveDict;
  Tracker.autorun(function() {
    all = dict.all();
  });

  test.equal(all, {});

  dict.set('foo', 'bar');
  Tracker.flush();
  test.equal(all, {foo: 'bar'});

  dict.set('blah', undefined);
  Tracker.flush();
  test.equal(all, {foo: 'bar', blah: undefined});
});


Tinytest.add('ReactiveDict - clear() works', function (test) {
  var dict = new ReactiveDict;
  dict.set('foo', 'bar');

  // Clear should not throw an error now
  // See issue #5530
  dict.clear();

  dict.set('foo', 'bar');

  var val, equals, equalsUndefined, all;
  Tracker.autorun(function() {
    val = dict.get('foo');
  });
  Tracker.autorun(function() {
    equals = dict.equals('foo', 'bar');
  });
  Tracker.autorun(function() {
    equalsUndefined = dict.equals('foo', undefined);
  });
  Tracker.autorun(function() {
    all = dict.all();
  });

  test.equal(val, 'bar');
  test.equal(equals, true);
  test.equal(equalsUndefined, false);
  test.equal(all, {foo: 'bar'});

  dict.clear();
  Tracker.flush();
  test.isUndefined(val);
  test.equal(equals, false);
  test.equal(equalsUndefined, true);
  test.equal(all, {});
});

Tinytest.add('ReactiveDict - delete(key) works', function (test) {
  var dict = new ReactiveDict;
  dict.set('foo', 'bar');
  dict.set('bar', 'foo');

  dict.set('baz', 123);
  test.equal(dict.delete('baz'), true);
  test.equal(dict.delete('baz'), false);

  var val, equals, equalsUndefined, all;

  Tracker.autorun(function() {
    val = dict.get('foo');
  });
  Tracker.autorun(function() {
    equals = dict.equals('foo', 'bar');
  });
  Tracker.autorun(function() {
    equalsUndefined = dict.equals('foo', undefined);
  });
  Tracker.autorun(function() {
    all = dict.all();
  });

  test.equal(val, 'bar');
  test.equal(equals, true);
  test.equal(equalsUndefined, false);
  test.equal(all, {foo: 'bar', bar: 'foo'});

  var didRemove = dict.delete('foo');
  test.equal(didRemove, true);

  Tracker.flush();

  test.isUndefined(val);
  test.equal(equals, false);
  test.equal(equalsUndefined, true);
  test.equal(all, {bar: 'foo'});

  didRemove = dict.delete('barfoobar');
  test.equal(didRemove, false);
});

Tinytest.add('ReactiveDict - destroy works', function (test) {
  var dict = new ReactiveDict('test');

  // Should throw on client when reload package is present
  Meteor.isClient && test.throws(function () {
    var dict2 = new ReactiveDict('test');
  }, 'Duplicate ReactiveDict name: test');

  dict.set('foo', 'bar');

  var val, equals, equalsUndefined, all;
  Tracker.autorun(function() {
    val = dict.get('foo');
  });
  Tracker.autorun(function() {
    equals = dict.equals('foo', 'bar');
  });
  Tracker.autorun(function() {
    equalsUndefined = dict.equals('foo', undefined);
  });
  Tracker.autorun(function() {
    all = dict.all();
  });

  test.equal(val, 'bar');
  test.equal(equals, true);
  test.equal(equalsUndefined, false);
  test.equal(all, {foo: 'bar'});

  // .destroy() should clear the dict
  dict.destroy();
  Tracker.flush();
  test.isUndefined(val);
  test.equal(equals, false);
  test.equal(equalsUndefined, true);
  test.equal(all, {});

  // Shouldn't throw now that we've destroyed the previous dict
  dict = new ReactiveDict('test');
});

Tinytest.add('ReactiveDict - has(key) reports presence', function (test) {
  const dict = new ReactiveDict({ initial: 1 });
  test.isTrue(dict.has('initial'));
  test.isFalse(dict.has('foo'));

  [undefined, null, false, 0, ''].forEach(function (value, i) {
    dict.set(`k${i}`, value);
    test.isTrue(dict.has(`k${i}`));
  });

  dict.set({ fromObject: undefined });
  test.isTrue(dict.has('fromObject'));
  dict.setDefault('fromDefault', undefined);
  test.isTrue(dict.has('fromDefault'));
  dict.setDefault({ fromDefaultObject: null });
  test.isTrue(dict.has('fromDefaultObject'));

  // Outside a computation, has() registers no dependency.
  test.equal(dict.keyPresenceDeps, {});
});

Tinytest.add('ReactiveDict - has(key) reruns only on presence changes', function (test) {
  const dict = new ReactiveDict;
  const seen = [];
  const other = [];
  const c1 = Tracker.autorun(function () {
    seen.push(dict.has('nickname'));
  });
  const c2 = Tracker.autorun(function () {
    other.push(dict.has('nickname'));
  });

  dict.set('nickname', undefined);
  Tracker.flush();
  test.equal(seen, [false, true]);

  // Value-only changes and unrelated keys do not rerun.
  dict.set('nickname', 'Ada');
  dict.set('unrelated', 1);
  dict.setDefault('nickname', 'other');
  dict.setDefault({ nickname: 'other' });
  Tracker.flush();
  test.equal(seen, [false, true]);

  dict.delete('nickname');
  Tracker.flush();
  test.equal(seen, [false, true, false]);

  // Deleting or clearing an absent key is not a presence change.
  dict.delete('nickname');
  dict.clear();
  Tracker.flush();
  test.equal(seen, [false, true, false]);

  dict.set({ nickname: 'Ada' });
  Tracker.flush();
  test.equal(seen, [false, true, false, true]);

  dict.clear();
  Tracker.flush();
  test.equal(seen, [false, true, false, true, false]);
  test.equal(other, seen);

  // A stopped computation is not rerun, and the other reader still is.
  c1.stop();
  dict.setDefault('nickname', 'x');
  Tracker.flush();
  test.equal(seen, [false, true, false, true, false]);
  test.equal(other, [false, true, false, true, false, true]);

  c2.stop();
  Tracker.flush();
  test.equal(dict.keyPresenceDeps, {});
});

Tinytest.add('ReactiveDict - has(key) after destroy', function (test) {
  const dict = new ReactiveDict('has-destroy', { foo: 'bar' });
  const seen = [];
  const c = Tracker.autorun(function () {
    seen.push(dict.has('foo'));
  });

  dict.destroy();
  Tracker.flush();
  test.equal(seen, [true, false]);
  c.stop();
});
