const { raiseMinSdk } = require('../../app.plugin.js');

const property = (value: string) => ({ type: 'property', key: 'android.minSdkVersion', value });

describe('raiseMinSdk', () => {
  it('adds the property when the app has none', () => {
    const properties: object[] = [];
    raiseMinSdk(properties);
    expect(properties).toEqual([property('26')]);
  });

  it('raises a lower value', () => {
    const properties = [property('24')];
    raiseMinSdk(properties);
    expect(properties).toEqual([property('26')]);
  });

  it('leaves a value at or above the requirement alone', () => {
    for (const value of ['26', '29']) {
      const properties = [property(value)];
      raiseMinSdk(properties);
      expect(properties).toEqual([property(value)]);
    }
  });
});
